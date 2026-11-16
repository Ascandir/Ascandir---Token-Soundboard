/**
 * Ascandir - Token Soundboard
 * Hängt Sounds an Token. Der Spielleiter legt Sounds an und gibt sie bei Bedarf
 * für die Besitzer des Tokens frei. Abgespielte Sounds hört man nur in der Nähe
 * des Tokens – je weiter weg, desto leiser.
 *
 * Datenablage:
 *  - Sound-Liste ("sounds") am Actor des Tokens (bei verknüpften Token also überall
 *    dabei, bei unverknüpften Token nur an diesem einen Token).
 *  - Gerade laufende Sounds ("playing") am Token-Dokument der Szene. Jeder Client
 *    sieht diese Daten und spielt den Sound lokal ab, mit seiner eigenen Lautstärke
 *    je nach Abstand seines Tokens. Spät beitretende Spieler steigen an der richtigen
 *    Stelle ein, weil die Startzeit mitgespeichert wird.
 */

const ID = "ascandir-token-soundboard";

const LEVELS = ["whisper", "quiet", "medium", "loud", "veryLoud"];
/** Standard-Reichweiten in Szenen-Einheiten (bei D&D: Fuß). */
const LEVEL_RANGE = { whisper: 10, quiet: 30, medium: 60, loud: 120, veryLoud: 240 };
/** Grundlautstärke direkt neben der Quelle. */
const LEVEL_GAIN = { whisper: 0.35, quiet: 0.55, medium: 0.75, loud: 0.9, veryLoud: 1 };
/** Innerhalb dieses Anteils der Reichweite ist der Sound voll laut. */
const INNER_SHARE = 0.25;
/** So viel bleibt übrig, wenn eine Wand dazwischen ist (Modus "dämpfen"). */
const MUFFLE = 0.35;
const FADE_MS = 600;
const DURATIONS = [0, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/* -------------------------------------------- */
/*  Hilfsfunktionen                             */
/* -------------------------------------------- */

const t = (key, data) => (data ? game.i18n.format(`ATS.${key}`, data) : game.i18n.localize(`ATS.${key}`));
const setting = (key) => game.settings.get(ID, key);
const now = () => game.time?.serverTime ?? Date.now();

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nameFromPath(path) {
  const file = String(path ?? "").split("/").pop() ?? "";
  let name = file.replace(/\.[a-z0-9]+$/i, "");
  try { name = decodeURIComponent(name); } catch (e) { /* egal */ }
  return name.replace(/[_-]+/g, " ").trim() || "Sound";
}

/** Wo die Sound-Liste dieses Tokens liegt. */
function libDoc(tokenDoc) {
  return tokenDoc?.actor ?? tokenDoc;
}

function normalizeEntry(e) {
  return {
    id: e.id ?? foundry.utils.randomID(),
    name: String(e.name ?? "Sound"),
    src: String(e.src ?? ""),
    shared: !!e.shared,
    level: LEVELS.includes(e.level) ? e.level : "medium",
    loop: !!e.loop,
    duration: Math.max(0, Number(e.duration) || 0)
  };
}

function getLibrary(tokenDoc) {
  const arr = libDoc(tokenDoc)?.getFlag(ID, "sounds");
  return Array.isArray(arr) ? arr.map(normalizeEntry) : [];
}

async function setLibrary(tokenDoc, arr) {
  return libDoc(tokenDoc).setFlag(ID, "sounds", arr);
}

function getPlaying(tokenDoc) {
  const arr = tokenDoc?.getFlag(ID, "playing");
  return Array.isArray(arr) ? arr : [];
}

async function setPlaying(tokenDoc, arr) {
  return tokenDoc.setFlag(ID, "playing", arr);
}

function isExpired(play) {
  return !!play.ends && now() > play.ends + 1000;
}

function visibleSounds(tokenDoc) {
  const lib = getLibrary(tokenDoc);
  return game.user.isGM ? lib : lib.filter((s) => s.shared);
}

function canPlay(tokenDoc, entry) {
  return game.user.isGM || (tokenDoc.isOwner && entry?.shared);
}

function rangeFor(level) {
  const v = Number(setting(`range.${level}`));
  return v > 0 ? v : LEVEL_RANGE[level] ?? 60;
}

function isResponsibleFor(play) {
  const gm = game.users.activeGM;
  if (gm) return gm.isSelf;
  return play.user === game.user.id;
}

/** Länge einer Audiodatei in Sekunden (0, wenn unbekannt). */
async function probeLength(src) {
  try {
    const sound = new foundry.audio.Sound(src, { context: game.audio.environment });
    await sound.load();
    return Number(sound.duration) || 0;
  } catch (err) {
    console.warn(`${ID} | Konnte Länge nicht ermitteln`, src, err);
    return 0;
  }
}

/* -------------------------------------------- */
/*  Abspielen & Stoppen (schreibt die Daten)    */
/* -------------------------------------------- */

/**
 * Wann endet ein Sound? null = läuft, bis jemand ihn stoppt.
 * Ohne Loop endet er am Ende des gerade laufenden Durchgangs; eine gewählte Dauer begrenzt zusätzlich.
 */
function computeEnds(start, entry, length) {
  const elapsed = Math.max(0, (now() - start) / 1000);
  const ends = [];
  if (!entry.loop && length) ends.push(start + Math.max(1, Math.ceil(elapsed / length)) * length * 1000);
  if (entry.duration > 0) ends.push(start + entry.duration * 1000);
  return ends.length ? Math.min(...ends) : null;
}

async function playSound(tokenDoc, soundId) {
  const entry = getLibrary(tokenDoc).find((s) => s.id === soundId);
  if (!entry || !entry.src) return;
  if (!canPlay(tokenDoc, entry)) {
    ui.notifications.warn(t("Notify.NoPermission"));
    return;
  }
  return startPlay(tokenDoc, entry, entry.id);
}

/**
 * Startet einen Sound an einem Token.
 * @param {TokenDocument} tokenDoc
 * @param {{name, src, level, loop, duration}} entry
 * @param {string} key  Kennung – ein erneuter Start mit derselben Kennung ersetzt den alten.
 */
async function startPlay(tokenDoc, entry, key) {
  const length = await probeLength(entry.src);
  if (!length) {
    // Datei fehlt oder ist kaputt – lieber Bescheid geben als still nichts tun.
    const ok = await fetch(entry.src, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
    if (!ok) {
      ui.notifications.error(t("Notify.LoadFailed", { src: entry.src }));
      return;
    }
  }

  const start = now();
  const play = {
    id: foundry.utils.randomID(),
    soundId: key,
    name: entry.name,
    src: entry.src,
    level: LEVELS.includes(entry.level) ? entry.level : "medium",
    loop: !!entry.loop,
    start,
    ends: computeEnds(start, entry, length),
    user: game.user.id
  };

  const list = getPlaying(tokenDoc).filter((p) => p.soundId !== key && !isExpired(p));
  list.push(play);
  await setPlaying(tokenDoc, list);
}

/* -------------------------------------------- */
/*  Sounds an Aktionen, Zaubern & Gegenständen  */
/* -------------------------------------------- */

const itemKey = (item) => `item.${item.id}`;

/** Sound-Einstellung eines Gegenstands/Zaubers (oder null). */
function getItemSound(item) {
  const raw = item?.getFlag?.(ID, "itemSound");
  if (!raw || typeof raw !== "object") return null;
  return {
    enabled: raw.enabled !== false,
    source: raw.source === "board" ? "board" : "file",
    boardId: String(raw.boardId ?? ""),
    src: String(raw.src ?? ""),
    level: LEVELS.includes(raw.level) ? raw.level : "medium",
    loop: !!raw.loop,
    duration: Math.max(0, Number(raw.duration) || 0)
  };
}

/** Darf dieser Benutzer den Sound eines Gegenstands einstellen? */
function canConfigureItem(item) {
  if (game.user.isGM) return true;
  return !!item?.isOwner && setting("playersItemSounds");
}

/** Welche Datei spielt der Gegenstand ab? (Soundboard-Sound hat Vorrang, falls gewählt.) */
function resolveItemSound(item, cfg = getItemSound(item)) {
  if (!cfg?.enabled) return null;
  let src = cfg.src;
  if (cfg.source === "board" && item.actor) {
    const lib = item.actor.getFlag(ID, "sounds");
    const entry = Array.isArray(lib) ? lib.find((s) => s.id === cfg.boardId) : null;
    if (entry?.src) src = entry.src;
  }
  if (!src) return null;
  return { name: item.name, src, level: cfg.level, loop: cfg.loop, duration: cfg.duration };
}

/** Passender Token zum Akteur – bevorzugt auf der aktuellen Szene. */
function tokenForActor(actor, preferred) {
  if (!actor) return null;
  const pref = preferred?.document ?? preferred;
  if (pref?.actor === actor || (pref && pref.actorId === actor.id && pref.actorLink)) return pref;
  if (actor.isToken && actor.token) return actor.token;
  const controlled = canvas.tokens?.controlled?.find((tk) => tk.actor === actor);
  if (controlled) return controlled.document;
  const active = actor.getActiveTokens?.(true, true) ?? [];
  return active.find((td) => td.parent === canvas.scene) ?? active[0] ?? null;
}

async function playItemSound(item, { token } = {}) {
  const entry = resolveItemSound(item);
  if (!entry) return false;
  const tokenDoc = tokenForActor(item.actor, token);
  if (!tokenDoc?.isOwner) return false;
  await startPlay(tokenDoc, entry, itemKey(item));
  return true;
}

/** Beim Benutzen einer Aktivität (Angriff, Zauber, Fähigkeit …) den Sound abspielen. */
function onUseActivity(activity, usageConfig, results) {
  try {
    const item = activity?.item;
    if (!item?.actor || !getItemSound(item)?.enabled) return;
    const speaker = results?.message?.speaker;
    const token = speaker?.token ? game.scenes.get(speaker.scene)?.tokens.get(speaker.token) : null;
    playItemSound(item, { token }).catch((err) => console.error(`${ID} |`, err));
  } catch (err) {
    console.error(`${ID} | Sound zur Aktion konnte nicht gestartet werden`, err);
  }
  // Nichts zurückgeben: "false" würde dnd5e die weitere Verarbeitung verbieten.
}

async function stopSound(tokenDoc, soundId) {
  const list = getPlaying(tokenDoc);
  const rest = list.filter((p) => p.soundId !== soundId);
  if (rest.length !== list.length) await setPlaying(tokenDoc, rest);
}

async function stopAll(tokenDoc) {
  if (getPlaying(tokenDoc).length) await setPlaying(tokenDoc, []);
}

async function removePlay(tokenDoc, playId) {
  const list = getPlaying(tokenDoc);
  const rest = list.filter((p) => p.id !== playId);
  if (rest.length !== list.length) await setPlaying(tokenDoc, rest);
}

async function updateEntry(tokenDoc, soundId, patch) {
  if (!game.user.isGM) {
    // Spieler dürfen nur Lautstärke, Dauer und Wiederholung ändern – und nur bei freigegebenen Sounds.
    const entry = getLibrary(tokenDoc).find((s) => s.id === soundId);
    if (!entry?.shared || !tokenDoc.isOwner) return;
    patch = Object.fromEntries(Object.entries(patch).filter(([k]) => ["level", "loop", "duration"].includes(k)));
  }
  if (!Object.keys(patch).length) return;

  const lib = getLibrary(tokenDoc).map((s) => (s.id === soundId ? normalizeEntry({ ...s, ...patch }) : s));
  await setLibrary(tokenDoc, lib);

  // Lautstärke, Loop und Dauer gelten sofort, auch für einen bereits laufenden Sound.
  const live = ["level", "loop", "duration"].filter((k) => k in patch);
  const list = getPlaying(tokenDoc);
  if (!live.length || !list.some((p) => p.soundId === soundId)) return;

  const entry = lib.find((s) => s.id === soundId);
  const length = "loop" in patch || "duration" in patch ? await probeLength(entry.src) : 0;
  const updated = list.map((p) => {
    if (p.soundId !== soundId) return p;
    const next = { ...p, level: entry.level };
    if ("loop" in patch || "duration" in patch) {
      next.loop = entry.loop;
      next.ends = computeEnds(p.start, entry, length);
    }
    return next;
  });
  await setPlaying(tokenDoc, updated);
}

async function addEntries(tokenDoc, entries) {
  if (!game.user.isGM || !entries.length) return;
  const lib = getLibrary(tokenDoc);
  for (const e of entries) lib.push(normalizeEntry(e));
  await setLibrary(tokenDoc, lib);
  if (entries.length === 1) ui.notifications.info(t("Notify.Added", { name: entries[0].name }));
}

async function deleteEntry(tokenDoc, soundId) {
  if (!game.user.isGM) return;
  await stopSound(tokenDoc, soundId);
  await setLibrary(tokenDoc, getLibrary(tokenDoc).filter((s) => s.id !== soundId));
}

/* -------------------------------------------- */
/*  Wiedergabe auf diesem Client                */
/* -------------------------------------------- */

const Engine = {
  /** key "tokenId.playId" → { play, tokenId, sound, current, dead, timer } */
  active: new Map(),
  volumeTimer: null,

  /** Gleicht die laufenden Sounds mit den Daten der aktuellen Szene ab. */
  sync() {
    const wanted = new Map();
    const scene = canvas?.ready ? canvas.scene : null;
    if (scene) {
      for (const td of scene.tokens) {
        for (const play of getPlaying(td)) {
          if (!play?.id || !play.src || isExpired(play)) continue;
          wanted.set(`${td.id}.${play.id}`, { play, tokenId: td.id });
        }
      }
    }

    for (const key of [...this.active.keys()]) {
      if (!wanted.has(key)) this.stop(key);
    }
    for (const [key, w] of wanted) {
      const rec = this.active.get(key);
      if (!rec) {
        this.start(key, w.play, w.tokenId);
        continue;
      }
      const loopChanged = !!rec.play.loop !== !!w.play.loop;
      const endsChanged = (rec.play.ends ?? null) !== (w.play.ends ?? null);
      rec.play = w.play;
      if (loopChanged) this.restart(key);
      else if (endsChanged) this.armTimer(key, rec);
    }
    this.scheduleVolume();
  },

  /** Startet einen Sound an der passenden Stelle neu (kurzes Überblenden). */
  restart(key) {
    const rec = this.active.get(key);
    if (!rec) return;
    this.stop(key);
    this.start(key, rec.play, rec.tokenId);
  },

  armTimer(key, rec) {
    clearTimeout(rec.timer);
    rec.timer = null;
    if (!rec.play.ends) return;
    rec.timer = setTimeout(() => {
      if (this.active.get(key) === rec) this.finish(key);
    }, Math.max(0, rec.play.ends - now()));
  },

  /**
   * Sicherheitsnetz: Hat der Browser einen Sound beendet, der eigentlich noch
   * laufen soll (z. B. Loop bei langen, gestreamten Dateien), wird er neu gestartet.
   */
  watchdog() {
    if (game.audio.locked) return;
    for (const [key, rec] of [...this.active]) {
      if (rec.dead || !rec.started || rec.sound?.playing) continue;
      const play = rec.play;
      if (play.ends && now() >= play.ends) this.finish(key);
      else if (!play.loop && !play.ends) this.finish(key);
      else {
        console.log(`${ID} | Sound war unerwartet beendet, starte neu:`, play.name);
        this.restart(key);
      }
    }
  },

  async start(key, play, tokenId) {
    const rec = { play, tokenId, sound: null, current: 0, dead: false, started: false, timer: null };
    this.active.set(key, rec);
    try {
      if (game.audio.locked) await (game.audio.unlock ?? game.audio.awaitFirstGesture?.());
      if (rec.dead) return;

      const sound = new foundry.audio.Sound(play.src, { context: game.audio.environment });
      await sound.load();
      if (rec.dead) return;
      rec.sound = sound;

      const length = Number(sound.duration) || 0;
      const elapsed = Math.max(0, (now() - play.start) / 1000);
      if (play.ends && now() >= play.ends) return this.finish(key);
      if (!play.loop && !play.ends && length && elapsed >= length) return this.finish(key);

      const offset = length ? elapsed % length : 0;
      await sound.play({ loop: !!play.loop, offset, volume: 0 });
      if (rec.dead) {
        sound.stop();
        return;
      }
      rec.started = true;
      Notes.wake();

      rec.current = this.targetVolume(rec);
      sound.fade(rec.current, { duration: FADE_MS });

      this.armTimer(key, rec);
      if (typeof sound.addEventListener === "function") {
        sound.addEventListener("end", () => {
          if (this.active.get(key) !== rec || rec.play.loop) return;
          this.finish(key);
        }, { once: true });
      }
    } catch (err) {
      console.error(`${ID} | Sound konnte nicht abgespielt werden`, play.src, err);
      if (play.user === game.user.id) ui.notifications.error(t("Notify.LoadFailed", { src: play.src }));
    }
  },

  /** Sound lokal ausblenden und anhalten. */
  stop(key) {
    const rec = this.active.get(key);
    if (!rec) return;
    rec.dead = true;
    clearTimeout(rec.timer);
    this.active.delete(key);
    const sound = rec.sound;
    if (!sound) return;
    try {
      if (sound.playing) {
        sound.fade(0, { duration: FADE_MS });
        setTimeout(() => sound.stop(), FADE_MS + 50);
      } else sound.stop();
    } catch (err) {
      /* bereits gestoppt */
    }
  },

  /** Sound ist zu Ende: lokal stoppen und (falls zuständig) aus den Daten entfernen. */
  finish(key) {
    const rec = this.active.get(key);
    if (!rec) return;
    this.stop(key);
    if (!isResponsibleFor(rec.play)) return;
    const td = canvas.scene?.tokens.get(rec.tokenId);
    if (td) removePlay(td, rec.play.id).catch((err) => console.error(`${ID} |`, err));
  },

  stopAllLocal() {
    for (const key of [...this.active.keys()]) this.stop(key);
  },

  /* ---------- Lautstärke je nach Abstand ---------- */

  scheduleVolume() {
    if (this.volumeTimer || !this.active.size) return;
    this.volumeTimer = setTimeout(() => {
      this.volumeTimer = null;
      this.applyVolumes();
    }, 80);
  },

  applyVolumes() {
    for (const rec of this.active.values()) {
      if (!rec.sound?.playing) continue;
      const v = this.targetVolume(rec);
      if (Math.abs(v - rec.current) < 0.005) continue;
      rec.current = v;
      try { rec.sound.fade(v, { duration: 250 }); } catch (e) { /* egal */ }
    }
  },

  /** Wer "hört" auf diesem Client? */
  listeners() {
    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length) return controlled;
    if (game.user.isGM) return setting("gmHearsAll") ? "all" : [];
    return (canvas.tokens?.placeables ?? []).filter((tk) => tk.document.isOwner);
  },

  targetVolume(rec) {
    const source = canvas.tokens?.get(rec.tokenId);
    if (!source) return 0;
    const level = LEVELS.includes(rec.play.level) ? rec.play.level : "medium";
    const personal = Number(setting("volume"));
    const base = LEVEL_GAIN[level] * (Number.isFinite(personal) ? Math.max(0, personal) : 1);

    const listeners = this.listeners();
    if (listeners === "all") return base;
    if (!listeners.length) return 0;

    const range = rangeFor(level);
    const inner = range * INNER_SHARE;
    const a = tokenCenter(source);
    const wallMode = setting("wallMode");

    let best = 0;
    for (const listener of listeners) {
      if (listener === source) return base;
      const b = tokenCenter(listener);
      let f = falloff(distance(a, b), inner, range);
      if (f > 0 && wallMode !== "none" && blockedBySound(a, b)) f *= wallMode === "block" ? 0 : MUFFLE;
      if (f > best) best = f;
    }
    return base * best;
  }
};

/** Mittelpunkt – nimmt die gerade animierte Position, damit es beim Laufen flüssig klingt. */
function tokenCenter(token) {
  const w = token.w ?? token.width ?? 0;
  const h = token.h ?? token.height ?? 0;
  if (Number.isFinite(token.x) && Number.isFinite(token.y)) return { x: token.x + w / 2, y: token.y + h / 2 };
  return token.center;
}

/** Abstand in Szenen-Einheiten (z. B. Fuß), Luftlinie. */
function distance(a, b) {
  const d = canvas.dimensions;
  return (Math.hypot(a.x - b.x, a.y - b.y) / d.size) * d.distance;
}

/** Voll laut bis "inner", dann sanft auf 0 bei "range". */
function falloff(dist, inner, range) {
  if (dist <= inner) return 1;
  if (dist >= range) return 0;
  const x = (dist - inner) / (range - inner);
  return 0.5 * (1 + Math.cos(Math.PI * x));
}

function blockedBySound(a, b) {
  try {
    const backend = CONFIG.Canvas.polygonBackends?.sound;
    return !!backend?.testCollision?.(a, b, { type: "sound", mode: "any" });
  } catch (err) {
    return false;
  }
}

/** Aktiver SL räumt regelmäßig abgelaufene Einträge in allen Szenen auf. */
function janitor() {
  const gm = game.users.activeGM;
  if (!gm?.isSelf) return;
  for (const scene of game.scenes) {
    for (const td of scene.tokens) {
      const list = getPlaying(td);
      if (!list.length) continue;
      const rest = list.filter((p) => !isExpired(p));
      if (rest.length !== list.length) setPlaying(td, rest).catch(() => {});
    }
  }
}

/* -------------------------------------------- */
/*  Soundboard-Fenster                          */
/* -------------------------------------------- */

class SoundboardApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["ats-soundboard"],
    window: {
      title: "ATS.Title",
      icon: "fa-solid fa-music",
      resizable: true
    },
    position: { width: 560, height: "auto" },
    actions: {
      toggle: SoundboardApp.#onToggle,
      setLevel: SoundboardApp.#onSetLevel,
      toggleLoop: SoundboardApp.#onToggleLoop,
      toggleShared: SoundboardApp.#onToggleShared,
      pickFile: SoundboardApp.#onPickFile,
      deleteSound: SoundboardApp.#onDelete,
      addSound: SoundboardApp.#onAdd,
      stopAll: SoundboardApp.#onStopAll,
      toggleItem: SoundboardApp.#onToggleItem,
      configItem: SoundboardApp.#onConfigItem
    }
  };

  static #item(app, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return app.tokenDoc.actor?.items.get(id) ?? null;
  }

  static async #onToggleItem(event, target) {
    const item = SoundboardApp.#item(this, target);
    if (!item) return;
    const key = itemKey(item);
    const running = getPlaying(this.tokenDoc).some((p) => p.soundId === key && !isExpired(p));
    target.disabled = true;
    try {
      if (running) await stopSound(this.tokenDoc, key);
      else {
        const entry = resolveItemSound(item);
        if (entry && this.tokenDoc.isOwner) await startPlay(this.tokenDoc, entry, key);
      }
    } finally {
      target.disabled = false;
    }
  }

  static #onConfigItem(event, target) {
    const item = SoundboardApp.#item(this, target);
    if (item) ItemSoundConfig.open(item);
  }

  /** Öffnet das Soundboard für einen Token (oder holt es nach vorne). */
  static open(tokenDoc) {
    const id = `ats-soundboard-${tokenDoc.parent?.id ?? "x"}-${tokenDoc.id}`;
    const existing = foundry.applications.instances?.get(id);
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new SoundboardApp({ id, tokenDoc });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.tokenDoc = options.tokenDoc;
  }

  get title() {
    return t("WindowTitle", { name: this.tokenDoc?.name ?? "" });
  }

  /** Gehört diese Änderung zu meinem Token? */
  concerns(doc) {
    if (!this.tokenDoc) return false;
    return doc === this.tokenDoc || doc === libDoc(this.tokenDoc) || doc?.id === libDoc(this.tokenDoc)?.id;
  }

  async _renderHTML() {
    const td = this.tokenDoc;
    const isGM = game.user.isGM;
    const sounds = visibleSounds(td);
    const playing = new Set(getPlaying(td).filter((p) => !isExpired(p)).map((p) => p.soundId));
    const units = canvas.scene?.grid?.units || td.parent?.grid?.units || "ft";

    const rows = sounds.map((s) => {
      const isPlaying = playing.has(s.id);
      const levels = LEVELS.map((lv) => {
        const tip = `${t(`Levels.${lv}`)} – ${t("Board.Range", { range: rangeFor(lv), units })}`;
        return `<button type="button" class="ats-level${s.level === lv ? " active" : ""}" data-action="setLevel" data-level="${lv}" data-tooltip="${esc(tip)}">${esc(t(`Levels.${lv}`))}</button>`;
      }).join("");

      const durations = DURATIONS.map((d) => `<option value="${d}"${s.duration === d ? " selected" : ""}>${esc(t(`Durations.${d}`))}</option>`);
      if (!DURATIONS.includes(s.duration)) durations.push(`<option value="${s.duration}" selected>${s.duration} s</option>`);

      const name = isGM
        ? `<input type="text" class="ats-name" data-field="name" value="${esc(s.name)}" placeholder="${esc(t("Board.Name"))}">`
        : `<span class="ats-name">${esc(s.name)}</span>`;

      const gmTools = isGM
        ? `<div class="ats-gm-tools">
             <button type="button" class="ats-icon${s.shared ? " active" : ""}" data-action="toggleShared" data-tooltip="${esc(t(s.shared ? "Board.Shared" : "Board.NotShared"))}"><i class="fa-solid ${s.shared ? "fa-user-check" : "fa-user-lock"}"></i></button>
             <button type="button" class="ats-icon" data-action="pickFile" data-tooltip="${esc(`${t("Board.PickFile")}: ${s.src}`)}"><i class="fa-solid fa-file-audio"></i></button>
             <button type="button" class="ats-icon ats-danger" data-action="deleteSound" data-tooltip="${esc(t("Board.Delete"))}"><i class="fa-solid fa-trash"></i></button>
           </div>`
        : "";

      return `
        <li class="ats-row${isPlaying ? " playing" : ""}" data-sound-id="${esc(s.id)}">
          <button type="button" class="ats-play" data-action="toggle" data-tooltip="${esc(t(isPlaying ? "Board.Stop" : "Board.Play"))}">
            <i class="fa-solid ${isPlaying ? "fa-stop" : "fa-play"}"></i>
          </button>
          <div class="ats-main">
            <div class="ats-top">
              ${name}
              ${isPlaying ? `<span class="ats-badge"><i class="fa-solid fa-volume-high"></i> ${esc(t("Board.Playing"))}</span>` : ""}
              ${gmTools}
            </div>
            <div class="ats-levels">${levels}</div>
            <div class="ats-options" data-tooltip="${esc(t("Board.LoopNextHint"))}">
              <button type="button" class="ats-loop${s.loop ? " active" : ""}" data-action="toggleLoop">
                <i class="fa-solid fa-repeat"></i> ${esc(t("Board.Loop"))}
              </button>
              <label class="ats-duration">
                <i class="fa-solid fa-hourglass-half"></i> ${esc(t("Board.Duration"))}
                <select data-field="duration">${durations.join("")}</select>
              </label>
            </div>
          </div>
        </li>`;
    }).join("");

    // Gegenstände/Zauber mit Sound
    const actor = td.actor;
    const canConfig = !!actor && (isGM || (actor.isOwner && setting("playersItemSounds")));
    const items = (actor?.items ? [...actor.items] : [])
      .map((item) => ({ item, cfg: getItemSound(item) }))
      .filter(({ cfg }) => cfg && (cfg.enabled || canConfig))
      .sort((a, b) => a.item.name.localeCompare(b.item.name));

    const itemRows = items.map(({ item, cfg }) => {
      const isPlaying = playing.has(itemKey(item));
      const playable = cfg.enabled && !!resolveItemSound(item, cfg);
      const info = [
        t(`Levels.${cfg.level}`),
        cfg.loop ? t("Board.Loop") : null,
        cfg.duration ? (DURATIONS.includes(cfg.duration) ? t(`Durations.${cfg.duration}`) : `${cfg.duration} s`) : null
      ].filter(Boolean).join(" · ");
      return `
        <li class="ats-item-row${isPlaying ? " playing" : ""}${cfg.enabled ? "" : " disabled"}" data-item-id="${esc(item.id)}">
          <button type="button" class="ats-play small" data-action="toggleItem"${playable || isPlaying ? "" : " disabled"} data-tooltip="${esc(t(isPlaying ? "Board.Stop" : "Board.Play"))}">
            <i class="fa-solid ${isPlaying ? "fa-stop" : "fa-play"}"></i>
          </button>
          <img src="${esc(item.img)}" alt="">
          <span class="ats-item-name">${esc(item.name)}</span>
          <span class="ats-item-info">${esc(cfg.enabled ? info : t("Item.Off"))}</span>
          ${canConfig ? `<button type="button" class="ats-icon" data-action="configItem" data-tooltip="${esc(t("Item.Configure"))}"><i class="fa-solid fa-sliders"></i></button>` : ""}
        </li>`;
    }).join("");

    const itemSection = itemRows || canConfig
      ? `<section class="ats-items">
           <h3><i class="fa-solid fa-wand-sparkles"></i> ${esc(t("Item.Section"))}</h3>
           ${itemRows ? `<ol class="ats-item-list">${itemRows}</ol>` : ""}
           ${canConfig ? `<p class="ats-drop-hint"><i class="fa-solid fa-hand-pointer"></i> ${esc(t("Item.DropHint"))}</p>` : ""}
         </section>`
      : "";

    const empty = itemSection ? "" : `<p class="ats-empty">${esc(t(isGM ? "Board.Empty" : "Board.EmptyPlayer"))}</p>`;
    const footer = `
      <footer class="ats-footer">
        ${isGM ? `<button type="button" data-action="addSound"><i class="fa-solid fa-plus"></i> ${esc(t("Board.Add"))}</button>` : ""}
        <button type="button" data-action="stopAll"${playing.size ? "" : " disabled"}><i class="fa-solid fa-volume-xmark"></i> ${esc(t("Board.StopAll"))}</button>
      </footer>`;

    return `
      <header class="ats-head">
        <img src="${esc(td.texture?.src ?? "")}" alt="">
        <p>${esc(t(isGM ? "Board.HintGM" : "Board.HintPlayer"))}</p>
      </header>
      <div class="ats-scroll">
        ${rows ? `<ol class="ats-list">${rows}</ol>` : empty}
        ${itemSection}
      </div>
      ${footer}`;
  }

  _replaceHTML(result, content) {
    const box = content.querySelector(".ats-scroll");
    const scroll = box?.scrollTop ?? 0;
    content.innerHTML = result;
    const newBox = content.querySelector(".ats-scroll");
    if (newBox) newBox.scrollTop = scroll;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;

    for (const input of html.querySelectorAll("[data-field]")) {
      input.addEventListener("change", (event) => {
        const row = event.currentTarget.closest("[data-sound-id]");
        const field = event.currentTarget.dataset.field;
        let value = event.currentTarget.value;
        if (field === "duration") value = Number(value) || 0;
        if (field === "name") value = String(value).trim() || "Sound";
        updateEntry(this.tokenDoc, row.dataset.soundId, { [field]: value });
      });
    }

    const mayDrop = game.user.isGM || (this.tokenDoc.actor?.isOwner && setting("playersItemSounds"));
    if (mayDrop && !this._dropBound) {
      this._dropBound = true;
      html.addEventListener("dragover", (event) => {
        event.preventDefault();
        html.classList.add("ats-drag");
      });
      html.addEventListener("dragleave", (event) => {
        if (!html.contains(event.relatedTarget)) html.classList.remove("ats-drag");
      });
      html.addEventListener("drop", (event) => {
        html.classList.remove("ats-drag");
        this.#onDrop(event);
      });
    }
  }

  async #onDrop(event) {
    event.preventDefault();
    let data;
    try {
      const TE = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      data = TE.getDragEventData(event);
    } catch (err) {
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (e) { data = null; }
    }
    if (data?.type === "Item" && data.uuid) {
      const item = await fromUuid(data.uuid);
      const actor = this.tokenDoc.actor;
      if (!item || !actor || item.parent !== actor) {
        ui.notifications.warn(t("Notify.ItemWrongActor"));
        return;
      }
      if (canConfigureItem(item)) ItemSoundConfig.open(item);
      return;
    }
    if (!game.user.isGM || !data?.uuid || !["PlaylistSound", "Playlist"].includes(data.type)) {
      ui.notifications.warn(t(game.user.isGM ? "Notify.DropWrongType" : "Notify.ItemWrongActor"));
      return;
    }
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    const sounds = doc.documentName === "Playlist" ? [...doc.sounds] : [doc];
    await addEntries(this.tokenDoc, sounds.filter((s) => s.path).map((s) => ({ name: s.name, src: s.path })));
  }

  /* ---------- Aktionen ---------- */

  static #soundId(target) {
    return target.closest("[data-sound-id]")?.dataset.soundId;
  }

  static async #onToggle(event, target) {
    const id = SoundboardApp.#soundId(target);
    const running = getPlaying(this.tokenDoc).some((p) => p.soundId === id && !isExpired(p));
    target.disabled = true;
    try {
      if (running) await stopSound(this.tokenDoc, id);
      else await playSound(this.tokenDoc, id);
    } finally {
      target.disabled = false;
    }
  }

  static async #onSetLevel(event, target) {
    await updateEntry(this.tokenDoc, SoundboardApp.#soundId(target), { level: target.dataset.level });
  }

  static async #onToggleLoop(event, target) {
    const id = SoundboardApp.#soundId(target);
    const entry = getLibrary(this.tokenDoc).find((s) => s.id === id);
    await updateEntry(this.tokenDoc, id, { loop: !entry?.loop });
  }

  static async #onToggleShared(event, target) {
    const id = SoundboardApp.#soundId(target);
    const entry = getLibrary(this.tokenDoc).find((s) => s.id === id);
    await updateEntry(this.tokenDoc, id, { shared: !entry?.shared });
  }

  static async #onPickFile(event, target) {
    const id = SoundboardApp.#soundId(target);
    const entry = getLibrary(this.tokenDoc).find((s) => s.id === id);
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "audio",
      current: entry?.src ?? "",
      callback: (path) => {
        const patch = { src: path };
        // Name mitziehen, solange er noch der automatische Dateiname war.
        if (!entry?.name || entry.name === nameFromPath(entry.src)) patch.name = nameFromPath(path);
        updateEntry(this.tokenDoc, id, patch);
      }
    }).render(true);
  }

  static async #onDelete(event, target) {
    const id = SoundboardApp.#soundId(target);
    const entry = getLibrary(this.tokenDoc).find((s) => s.id === id);
    const DialogV2 = foundry.applications.api.DialogV2;
    const ok = await DialogV2.confirm({
      window: { title: t("Board.Delete") },
      content: `<p>${esc(t("Board.Delete"))}: <strong>${esc(entry?.name ?? "")}</strong>?</p>`
    });
    if (ok) await deleteEntry(this.tokenDoc, id);
  }

  static async #onAdd() {
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "audio",
      callback: (path) => addEntries(this.tokenDoc, [{ name: nameFromPath(path), src: path }])
    }).render(true);
  }

  static async #onStopAll() {
    await stopAll(this.tokenDoc);
  }
}

/* -------------------------------------------- */
/*  Aufsteigende Noten über spielenden Token    */
/* -------------------------------------------- */

const NOTE_GLYPHS = ["♪", "♫", "♬", "♩"];
/** Abstand zwischen zwei Noten in ms – je lauter, desto mehr Noten. */
const NOTE_INTERVAL = { whisper: 1500, quiet: 1150, medium: 850, loud: 620, veryLoud: 450 };
/** Wie hoch die Noten steigen (in Token-Höhen). */
const NOTE_RISE = { whisper: 0.6, quiet: 0.8, medium: 1, loud: 1.25, veryLoud: 1.5 };

const Notes = {
  layer: null,
  emitters: new Map(), // key → { el, next }
  raf: null,

  wake() {
    if (this.raf || !setting("showNotes")) return;
    this.raf = requestAnimationFrame((ts) => this.tick(ts));
  },

  getLayer() {
    if (this.layer?.isConnected) return this.layer;
    const layer = document.createElement("div");
    layer.id = "ats-notes-layer";
    const board = document.getElementById("board");
    if (board) board.after(layer);
    else document.body.append(layer);
    this.layer = layer;
    return layer;
  },

  clear() {
    for (const { el } of this.emitters.values()) el.remove();
    this.emitters.clear();
  },

  tick(ts) {
    this.raf = null;
    if (!canvas?.ready || !setting("showNotes")) {
      this.clear();
      return;
    }

    const zoom = canvas.stage?.scale?.x ?? 1;
    const grid = canvas.dimensions?.size ?? 100;
    const seen = new Set();

    for (const [key, rec] of Engine.active) {
      if (rec.dead || !rec.started || !rec.sound?.playing) continue;
      const token = canvas.tokens?.get(rec.tokenId);
      if (!token) continue;
      seen.add(key);

      let em = this.emitters.get(key);
      if (!em) {
        const el = document.createElement("div");
        el.className = "ats-note-emitter";
        this.getLayer().append(el);
        em = { el, next: ts };
        this.emitters.set(key, em);
      }

      // Unsichtbare Token (versteckt, außer Sicht) verraten sich nicht durch Noten.
      const visible = (token.isVisible ?? token.visible) && !document.hidden;
      em.el.style.display = visible ? "" : "none";
      if (!visible) continue;

      const w = token.w ?? grid;
      const h = token.h ?? grid;
      const pos = toScreen({ x: token.x + w / 2, y: token.y + h * 0.2 });
      em.el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`;

      if (ts >= em.next) {
        const level = LEVELS.includes(rec.play.level) ? rec.play.level : "medium";
        this.spawn(em.el, level, w, h, grid);
        em.next = ts + NOTE_INTERVAL[level] * (0.7 + Math.random() * 0.6);
      }
    }

    for (const [key, em] of this.emitters) {
      if (seen.has(key)) continue;
      // Laufende Noten noch ausfliegen lassen, dann aufräumen.
      if (!em.el.childElementCount) {
        em.el.remove();
        this.emitters.delete(key);
      }
    }

    if (seen.size || this.emitters.size) this.raf = requestAnimationFrame((t) => this.tick(t));
  },

  spawn(parent, level, w, h, grid) {
    const note = document.createElement("span");
    note.className = "ats-note";
    note.textContent = NOTE_GLYPHS[Math.floor(Math.random() * NOTE_GLYPHS.length)];
    const size = grid * (0.3 + Math.random() * 0.14);
    const dur = 2200 + Math.random() * 1200;
    note.style.fontSize = `${size}px`;
    note.style.setProperty("--x0", `${(Math.random() - 0.5) * w * 0.5}px`);
    note.style.setProperty("--dx", `${(Math.random() - 0.5) * w * 0.9}px`);
    note.style.setProperty("--sway", `${(Math.random() - 0.5) * w * 0.35}px`);
    note.style.setProperty("--rise", `${h * NOTE_RISE[level] * (0.8 + Math.random() * 0.4)}px`);
    note.style.setProperty("--rot", `${(Math.random() - 0.5) * 50}deg`);
    note.style.animationDuration = `${dur}ms`;
    note.addEventListener("animationend", () => note.remove(), { once: true });
    setTimeout(() => note.remove(), dur + 500);
    parent.append(note);
  }
};

/** Canvas-Koordinaten → Bildschirm-Koordinaten. */
function toScreen(point) {
  try {
    if (typeof canvas.clientCoordinatesFromCanvas === "function") {
      const p = canvas.clientCoordinatesFromCanvas(point);
      if (Number.isFinite(p?.x)) return p;
    }
  } catch (e) { /* Fallback unten */ }
  const p = canvas.stage.worldTransform.apply(point);
  const rect = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: rect.left + p.x, y: rect.top + p.y };
}

/* -------------------------------------------- */
/*  Sound-Einstellung für Aktion / Zauber       */
/* -------------------------------------------- */

class ItemSoundConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["ats-item-config"],
    window: {
      title: "ATS.Item.Title",
      icon: "fa-solid fa-music",
      resizable: false
    },
    position: { width: 440, height: "auto" },
    form: { handler: ItemSoundConfig.#onSubmit, closeOnSubmit: true, submitOnChange: false },
    actions: {
      pickFile: ItemSoundConfig.#onPickFile,
      preview: ItemSoundConfig.#onPreview,
      setLevel: ItemSoundConfig.#onSetLevel,
      remove: ItemSoundConfig.#onRemove
    }
  };

  static open(item) {
    if (!canConfigureItem(item)) {
      ui.notifications.warn(t("Notify.NoPermission"));
      return null;
    }
    const id = `ats-item-sound-${item.uuid.replace(/\./g, "-")}`;
    const existing = foundry.applications.instances?.get(id);
    if (existing) {
      existing.bringToFront?.();
      return existing;
    }
    const app = new ItemSoundConfig({ id, item });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.item = options.item;
    const cfg = getItemSound(this.item);
    const board = this.boardSounds();
    this.state = cfg ?? {
      enabled: true,
      source: board.length ? "board" : "file",
      boardId: board[0]?.id ?? "",
      src: "",
      level: "medium",
      loop: false,
      duration: 0
    };
    this.preview = null;
  }

  get title() {
    return t("Item.WindowTitle", { name: this.item?.name ?? "" });
  }

  boardSounds() {
    const lib = this.item?.actor?.getFlag(ID, "sounds");
    if (!Array.isArray(lib)) return [];
    return lib.map(normalizeEntry).filter((s) => s.src && (game.user.isGM || s.shared));
  }

  /** Aktuelle Werte aus dem Formular übernehmen (ohne zu speichern). */
  readForm() {
    const f = this.element;
    if (!f?.elements) return;
    const s = this.state;
    s.enabled = !!f.elements.enabled?.checked;
    s.source = f.elements.source?.value === "board" ? "board" : "file";
    s.boardId = f.elements.boardId?.value ?? s.boardId;
    s.src = (f.elements.src?.value ?? s.src).trim();
    s.loop = !!f.elements.loop?.checked;
    s.duration = Math.max(0, Number(f.elements.duration?.value) || 0);
  }

  async _renderHTML() {
    const s = this.state;
    const board = this.boardSounds();
    const units = canvas.scene?.grid?.units || "ft";

    const levels = LEVELS.map((lv) => {
      const tip = `${t(`Levels.${lv}`)} – ${t("Board.Range", { range: rangeFor(lv), units })}`;
      return `<button type="button" class="ats-level${s.level === lv ? " active" : ""}" data-action="setLevel" data-level="${lv}" data-tooltip="${esc(tip)}">${esc(t(`Levels.${lv}`))}</button>`;
    }).join("");

    const durations = DURATIONS.map((d) => `<option value="${d}"${s.duration === d ? " selected" : ""}>${esc(t(`Durations.${d}`))}</option>`);
    if (!DURATIONS.includes(s.duration)) durations.push(`<option value="${s.duration}" selected>${s.duration} s</option>`);

    const boardOptions = board.map((b) => `<option value="${esc(b.id)}"${s.boardId === b.id ? " selected" : ""}>${esc(b.name)}</option>`).join("");
    const useBoard = s.source === "board" && board.length;

    return `
      <header class="ats-head">
        <img src="${esc(this.item.img)}" alt="">
        <p>${esc(t("Item.Hint"))}</p>
      </header>

      <label class="ats-check">
        <input type="checkbox" name="enabled"${s.enabled ? " checked" : ""}>
        ${esc(t("Item.Enabled"))}
      </label>

      <fieldset>
        <legend>${esc(t("Item.Source"))}</legend>
        ${board.length ? `
          <label class="ats-radio">
            <input type="radio" name="source" value="board"${useBoard ? " checked" : ""}>
            ${esc(t("Item.FromBoard"))}
            <select name="boardId">${boardOptions}</select>
          </label>` : ""}
        <label class="ats-radio">
          <input type="radio" name="source" value="file"${useBoard ? "" : " checked"}>
          ${esc(t("Item.FromFile"))}
        </label>
        <div class="ats-file">
          <input type="text" name="src" value="${esc(s.src)}" placeholder="sounds/…">
          <button type="button" class="ats-icon" data-action="pickFile" data-tooltip="${esc(t("Board.PickFile"))}"><i class="fa-solid fa-file-audio"></i></button>
        </div>
      </fieldset>

      <fieldset>
        <legend>${esc(t("Item.Volume"))}</legend>
        <div class="ats-levels">${levels}</div>
        <div class="ats-options">
          <label class="ats-check"><input type="checkbox" name="loop"${s.loop ? " checked" : ""}> <i class="fa-solid fa-repeat"></i> ${esc(t("Board.Loop"))}</label>
          <label class="ats-duration">
            <i class="fa-solid fa-hourglass-half"></i> ${esc(t("Board.Duration"))}
            <select name="duration">${durations.join("")}</select>
          </label>
        </div>
      </fieldset>

      <footer class="ats-footer">
        <button type="button" data-action="preview"><i class="fa-solid ${this.preview ? "fa-stop" : "fa-headphones"}"></i> ${esc(t(this.preview ? "Item.PreviewStop" : "Item.Preview"))}</button>
        ${getItemSound(this.item) ? `<button type="button" data-action="remove"><i class="fa-solid fa-trash"></i> ${esc(t("Item.Remove"))}</button>` : ""}
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(t("Item.Save"))}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Auswahl im Soundboard-Menü oder Tippen eines Pfads wählt automatisch die passende Quelle.
    this.element.querySelector("[name=boardId]")?.addEventListener("change", () => {
      const r = this.element.querySelector("[name=source][value=board]");
      if (r) r.checked = true;
    });
    this.element.querySelector("[name=src]")?.addEventListener("input", () => {
      const r = this.element.querySelector("[name=source][value=file]");
      if (r) r.checked = true;
    });
  }

  async close(options) {
    this.stopPreview();
    return super.close(options);
  }

  currentSrc() {
    this.readForm();
    const s = this.state;
    if (s.source === "board") return this.boardSounds().find((b) => b.id === s.boardId)?.src ?? "";
    return s.src;
  }

  stopPreview() {
    const p = this.preview;
    this.preview = null;
    if (!p) return;
    try { p.stop(); } catch (e) { /* egal */ }
  }

  static async #onPreview() {
    if (this.preview) {
      this.stopPreview();
      return this.render();
    }
    const src = this.currentSrc();
    if (!src) return ui.notifications.warn(t("Item.NoFile"));
    try {
      const sound = new foundry.audio.Sound(src, { context: game.audio.environment });
      await sound.load();
      await sound.play({ volume: LEVEL_GAIN[this.state.level] ?? 0.75 });
      this.preview = sound;
      sound.addEventListener?.("end", () => {
        if (this.preview === sound) {
          this.preview = null;
          if (this.rendered) this.render();
        }
      }, { once: true });
    } catch (err) {
      ui.notifications.error(t("Notify.LoadFailed", { src }));
    }
    this.render();
  }

  static #onSetLevel(event, target) {
    this.readForm();
    this.state.level = target.dataset.level;
    for (const b of this.element.querySelectorAll(".ats-level")) b.classList.toggle("active", b === target);
  }

  static #onPickFile() {
    this.readForm();
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    new FP({
      type: "audio",
      current: this.state.src,
      callback: (path) => {
        this.state.src = path;
        this.state.source = "file";
        this.render();
      }
    }).render(true);
  }

  static async #onRemove() {
    this.stopPreview();
    await this.item.unsetFlag(ID, "itemSound");
    this.close();
  }

  static async #onSubmit() {
    this.readForm();
    const s = this.state;
    if (s.source === "file" && !s.src) return ui.notifications.warn(t("Item.NoFile"));
    await this.item.setFlag(ID, "itemSound", {
      enabled: s.enabled,
      source: s.source,
      boardId: s.boardId,
      src: s.src,
      level: s.level,
      loop: s.loop,
      duration: s.duration
    });
  }
}

/** Noten-Knopf in der Titelleiste von Gegenstands- und Zauberbögen. */
function onRenderItemSheet(app) {
  const item = app?.document ?? app?.item;
  if (item?.documentName !== "Item" || !canConfigureItem(item)) return;
  const header = app.window?.header ?? app.element?.querySelector?.(".window-header");
  if (!header || header.querySelector(".ats-item-header")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control icon fa-solid fa-music ats-item-header";
  btn.dataset.tooltip = t("Item.Configure");
  btn.setAttribute("aria-label", t("Item.Configure"));
  if (getItemSound(item)?.enabled) btn.classList.add("active");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    ItemSoundConfig.open(item);
  });

  const anchor = header.querySelector("[data-action='toggleControls'], [data-action='close']");
  if (anchor) anchor.before(btn);
  else header.append(btn);
}

function refreshItemHeaders(item) {
  for (const app of foundry.applications.instances?.values() ?? []) {
    if (app.document !== item) continue;
    const btn = app.window?.header?.querySelector(".ats-item-header");
    if (btn) btn.classList.toggle("active", !!getItemSound(item)?.enabled);
  }
}

function rerenderBoards(doc) {
  for (const app of foundry.applications.instances?.values() ?? []) {
    if (app instanceof SoundboardApp && app.concerns(doc)) app.render();
  }
}

function closeBoardsFor(tokenDoc) {
  for (const app of foundry.applications.instances?.values() ?? []) {
    if (app instanceof SoundboardApp && app.tokenDoc === tokenDoc) app.close();
  }
}

/* -------------------------------------------- */
/*  Button im Token-HUD (oben mittig)           */
/* -------------------------------------------- */

/** Hat dieser Token für den aktuellen Benutzer etwas im Soundboard? */
function hasBoardContent(tokenDoc) {
  if (game.user.isGM) return true;
  if (visibleSounds(tokenDoc).length) return true;
  const actor = tokenDoc.actor;
  if (!actor?.isOwner) return false;
  if (setting("playersItemSounds")) return true;
  return actor.items.some((item) => getItemSound(item)?.enabled);
}

/** Abstand eines Elements zur Oberkante von "root" in CSS-Pixeln (ohne Zoom). */
function offsetTopWithin(el, root) {
  let top = 0;
  let node = el;
  while (node && node !== root) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return node === root ? top : null;
}

/** Setzt den Button mittig über den Token – und über die obere Leiste, falls sie sichtbar ist. */
function placeTopButton(root, btn) {
  const gap = 6;
  const h = btn.offsetHeight || 36;
  let top = -h - gap;
  const bar = root.querySelector(".col.middle .bar2, .col.middle .attribute.top, .col.middle .attribute:first-child");
  if (bar && bar.offsetParent && getComputedStyle(bar).display !== "none") {
    const barTop = offsetTopWithin(bar, root);
    if (barTop !== null && barTop - h - gap < top) top = barTop - h - gap;
  }
  btn.style.top = `${top}px`;
}

function onRenderTokenHUD(hud, html) {
  const root = hud?.element ?? (html instanceof HTMLElement ? html : html?.[0]);
  const tokenDoc = hud?.object?.document ?? hud?.document;
  if (!root || !tokenDoc) return;
  if (!hasBoardContent(tokenDoc)) return;
  if (root.querySelector("[data-ats-action='soundboard']")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon ats-hud-button thf-ignore";
  btn.dataset.atsAction = "soundboard";
  btn.dataset.tooltip = t("HUD.Tooltip");
  btn.innerHTML = `<i class="fa-solid fa-music"></i>`;
  if (getPlaying(tokenDoc).some((p) => !isExpired(p))) btn.classList.add("active");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    SoundboardApp.open(tokenDoc);
  });
  root.append(btn);
  placeTopButton(root, btn);
  requestAnimationFrame(() => btn.isConnected && placeTopButton(root, btn));
}

function refreshHUDButton(tokenDoc) {
  const hud = canvas.tokens?.hud;
  if (!hud?.rendered || hud.object?.document !== tokenDoc) return;
  const btn = hud.element?.querySelector("[data-ats-action='soundboard']");
  if (btn) btn.classList.toggle("active", getPlaying(tokenDoc).some((p) => !isExpired(p)));
  else if (hasBoardContent(tokenDoc)) hud.render();
}

/* -------------------------------------------- */
/*  Einstellungen & Hooks                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  for (const level of LEVELS) {
    game.settings.register(ID, `range.${level}`, {
      name: game.i18n.format("ATS.Settings.Range.Name", { level: game.i18n.localize(`ATS.Levels.${level}`) }),
      hint: "ATS.Settings.Range.Hint",
      scope: "world",
      config: true,
      type: Number,
      default: LEVEL_RANGE[level],
      onChange: () => Engine.scheduleVolume()
    });
  }

  game.settings.register(ID, "wallMode", {
    name: "ATS.Settings.WallMode.Name",
    hint: "ATS.Settings.WallMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "ATS.Settings.WallMode.none",
      muffle: "ATS.Settings.WallMode.muffle",
      block: "ATS.Settings.WallMode.block"
    },
    default: "muffle",
    onChange: () => Engine.scheduleVolume()
  });

  game.settings.register(ID, "gmHearsAll", {
    name: "ATS.Settings.GmHearsAll.Name",
    hint: "ATS.Settings.GmHearsAll.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Engine.scheduleVolume()
  });

  game.settings.register(ID, "volume", {
    name: "ATS.Settings.Volume.Name",
    hint: "ATS.Settings.Volume.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 1,
    onChange: () => Engine.scheduleVolume()
  });

  game.settings.register(ID, "showNotes", {
    name: "ATS.Settings.ShowNotes.Name",
    hint: "ATS.Settings.ShowNotes.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (on) => (on ? Notes.wake() : Notes.clear())
  });

  game.settings.register(ID, "playersItemSounds", {
    name: "ATS.Settings.PlayersItemSounds.Name",
    hint: "ATS.Settings.PlayersItemSounds.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  setInterval(janitor, 10000);
  setInterval(() => Engine.watchdog(), 3000);
  const mod = game.modules.get(ID);
  if (mod) {
    mod.api = {
      open: (token) => SoundboardApp.open(token?.document ?? token),
      play: (token, soundId) => playSound(token?.document ?? token, soundId),
      stop: (token, soundId) => stopSound(token?.document ?? token, soundId),
      stopAll: (token) => stopAll(token?.document ?? token),
      playItem: (item, token) => playItemSound(item, { token }),
      configureItem: (item) => ItemSoundConfig.open(item)
    };
  }
});

Hooks.on("renderTokenHUD", onRenderTokenHUD);

Hooks.on("dnd5e.postUseActivity", onUseActivity);
Hooks.on("renderItemSheet5e", onRenderItemSheet);
Hooks.on("renderItemSheetV2", onRenderItemSheet);

function onItemChanged(item) {
  refreshItemHeaders(item);
  if (item.parent?.documentName === "Actor") {
    rerenderBoards(item.parent);
    for (const token of item.parent.getActiveTokens?.(false, true) ?? []) refreshHUDButton(token);
  }
}
Hooks.on("updateItem", onItemChanged);
Hooks.on("createItem", onItemChanged);
Hooks.on("deleteItem", onItemChanged);

Hooks.on("canvasReady", () => Engine.sync());
Hooks.on("canvasTearDown", () => {
  Engine.stopAllLocal();
  Notes.clear();
});

Hooks.on("updateToken", (doc, change) => {
  const touched = foundry.utils.hasProperty(change, `flags.${ID}`) || Object.keys(change).some((k) => k.startsWith(`flags.${ID}`));
  if (touched) {
    if (doc.parent === canvas.scene) Engine.sync();
    refreshHUDButton(doc);
  }
  rerenderBoards(doc);
  // Auch Änderungen am Delta (unverknüpfte Token) betreffen die Sound-Liste.
  if (doc.actor) rerenderBoards(doc.actor);
});

Hooks.on("updateActor", (actor) => {
  rerenderBoards(actor);
  for (const token of actor.getActiveTokens?.(false, true) ?? []) refreshHUDButton(token);
});

Hooks.on("deleteToken", (doc) => {
  closeBoardsFor(doc);
  if (doc.parent === canvas.scene) Engine.sync();
});

/** Kopierte Token sollen keine laufenden Sounds mitnehmen. */
Hooks.on("preCreateToken", (doc) => {
  if (getPlaying(doc).length) doc.updateSource({ [`flags.${ID}.playing`]: [] });
});

Hooks.on("refreshToken", () => Engine.scheduleVolume());
Hooks.on("controlToken", () => Engine.scheduleVolume());
Hooks.on("updateWall", () => Engine.scheduleVolume());
