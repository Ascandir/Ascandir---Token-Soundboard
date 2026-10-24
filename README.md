# Ascandir - Token Soundboard

Ein Foundry-VTT-Modul (v14), mit dem man Sounds an Token hängt – zum Beispiel eine Violine an den Barden. Wer in der Nähe steht, hört sie; wer weiter weg ist, hört sie leiser oder gar nicht.

## Installation

In Foundry unter **Add-on Modules → Install Module** diese Manifest-URL eintragen:

```
https://github.com/Ascandir/Ascandir---Token-Soundboard/releases/latest/download/module.json
```

## So funktioniert es

**Spielleiter**

1. Rechtsklick auf einen Token → links im Menü auf das **Noten-Symbol** klicken.
2. **Sound hinzufügen** wählt eine Audiodatei aus. Alternativ Sounds oder ganze Playlists aus der Playlist-Leiste in das Fenster ziehen.
3. Über das **Personen-Symbol** gibst du einen Sound für die Besitzer des Tokens frei.
4. Lautstärke, Dauer und Wiederholung kannst du genauso einstellen wie die Spieler.

**Spieler**

Das Noten-Symbol erscheint im Rechtsklick-Menü des eigenen Tokens, sobald der Spielleiter mindestens einen Sound freigegeben hat. Pro Sound lässt sich einstellen:

- **Lautstärke:** Flüstern, Leise, Mittel, Laut, Sehr laut
- **Wiederholen (Loop):** an oder aus
- **Dauer:** ohne Limit oder 15 Sekunden bis 60 Minuten

## Reichweiten (Standard)

| Lautstärke | Hörbar bis ca. |
|---|---|
| Flüstern | 10 ft |
| Leise | 30 ft |
| Mittel | 60 ft |
| Laut | 120 ft |
| Sehr laut | 240 ft |

Im ersten Viertel der Reichweite ist der Sound voll laut, danach wird er gleichmäßig leiser. Die Reichweiten kann der Spielleiter in den Moduleinstellungen ändern.

Jeder hört den Sound aus Sicht seines ausgewählten Tokens (Spieler ohne Auswahl: aus Sicht ihrer eigenen Token). Der Spielleiter hört ohne ausgewählten Token alles in Grundlautstärke – das lässt sich abschalten.

## Einstellungen

- **Reichweite** je Lautstärkestufe
- **Wände:** ignorieren, dämpfen (Standard) oder blockieren
- **SL hört alles ohne ausgewählten Token** (pro Rechner)
- **Persönliche Lautstärke** (pro Rechner, zusätzlich zur Umgebungslautstärke von Foundry)

## Zusammenspiel

Der Button hat eine feste Kennung, damit **Ascandir - Token HUD Folders** ihn in einen Ordner einsortieren kann.
