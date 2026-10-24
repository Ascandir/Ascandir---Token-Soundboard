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
    soundId: entry.id,
    name: entry.name,
    src: entry.src,
    level: entry.level,
    loop: entry.loop,
    start,
    ends: computeEnds(start, entry, length),
    user: game.user.id
  };

  const list = getPlaying(tokenDoc).filter((p) => p.soundId !== entry.id && !isExpired(p));
  list.push(play);
  await setPlaying(tokenDoc, list);
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
      stopAll: SoundboardApp.#onStopAll
    }
  };

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

    const empty = `<p class="ats-empty">${esc(t(isGM ? "Board.Empty" : "Board.EmptyPlayer"))}</p>`;
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
      ${rows ? `<ol class="ats-list">${rows}</ol>` : empty}
      ${footer}`;
  }

  _replaceHTML(result, content) {
    const list = content.querySelector(".ats-list");
    const scroll = list?.scrollTop ?? 0;
    content.innerHTML = result;
    const newList = content.querySelector(".ats-list");
    if (newList) newList.scrollTop = scroll;
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

    if (game.user.isGM && !this._dropBound) {
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
    if (!data?.uuid || !["PlaylistSound", "Playlist"].includes(data.type)) {
      ui.notifications.warn(t("Notify.DropWrongType"));
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
/*  Button im Token-HUD (linke Spalte)          */
/* -------------------------------------------- */

function onRenderTokenHUD(hud, html) {
  const root = hud?.element ?? (html instanceof HTMLElement ? html : html?.[0]);
  const tokenDoc = hud?.object?.document ?? hud?.document;
  if (!root || !tokenDoc) return;
  if (!game.user.isGM && !visibleSounds(tokenDoc).length) return;

  const col = root.querySelector(".col.left");
  if (!col || root.querySelector("[data-ats-action='soundboard']")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon ats-hud-button";
  btn.dataset.atsAction = "soundboard";
  btn.dataset.tooltip = t("HUD.Tooltip");
  btn.innerHTML = `<i class="fa-solid fa-music"></i>`;
  if (getPlaying(tokenDoc).some((p) => !isExpired(p))) btn.classList.add("active");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    SoundboardApp.open(tokenDoc);
  });
  col.append(btn);
}

function refreshHUDButton(tokenDoc) {
  const hud = canvas.tokens?.hud;
  if (!hud?.rendered || hud.object?.document !== tokenDoc) return;
  const btn = hud.element?.querySelector("[data-ats-action='soundboard']");
  if (btn) btn.classList.toggle("active", getPlaying(tokenDoc).some((p) => !isExpired(p)));
  else if (game.user.isGM || visibleSounds(tokenDoc).length) hud.render();
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
      stopAll: (token) => stopAll(token?.document ?? token)
    };
  }
});

Hooks.on("renderTokenHUD", onRenderTokenHUD);

Hooks.on("canvasReady", () => Engine.sync());
Hooks.on("canvasTearDown", () => Engine.stopAllLocal());

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
