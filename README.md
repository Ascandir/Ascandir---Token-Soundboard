# Ascandir - Token Soundboard

Ein Foundry-VTT-Modul (v14), mit dem man Sounds an Token hängt – zum Beispiel eine Violine an den Barden. Wer in der Nähe steht, hört sie; wer weiter weg ist, hört sie leiser oder gar nicht.

## Installation

In Foundry unter **Add-on Modules → Install Module** diese Manifest-URL eintragen:

```
https://github.com/Ascandir/Ascandir---Token-Soundboard/releases/latest/download/module.json
```

## So funktioniert es

**Spielleiter**

1. Rechtsklick auf einen Token → oben mittig über dem Token auf das **Noten-Symbol** klicken.
2. **Sound hinzufügen** wählt eine Audiodatei aus. Alternativ Sounds oder ganze Playlists aus der Playlist-Leiste in das Fenster ziehen.
3. Über das **Personen-Symbol** gibst du einen Sound für die Besitzer des Tokens frei.
4. Lautstärke, Dauer und Wiederholung kannst du genauso einstellen wie die Spieler.

**Spieler**

Das Noten-Symbol erscheint im Rechtsklick-Menü des eigenen Tokens (oben mittig), sobald der Spielleiter mindestens einen Sound freigegeben hat. Pro Sound lässt sich einstellen:

- **Lautstärke:** Flüstern, Leise, Mittel, Laut, Sehr laut
- **Wiederholen (Loop):** an oder aus
- **Dauer:** ohne Limit oder 15 Sekunden bis 60 Minuten

## Sounds an Waffen, Zauber und Aktionen anheften

Sounds stellst du im Soundboard ein (Lautstärke, Loop, Dauer) und heftest sie dann an Waffen, Zauber oder Aktionen. Sobald die Waffe, der Zauber oder die Aktion benutzt wird, spielt der Sound automatisch am Token, bei Waffen also beim Waffenangriff.

- **Ziehen:** Eine Waffe, einen Zauber oder eine Aktion vom Charakterbogen direkt auf einen Sound im Soundboard ziehen.
- **Auswählen:** Beim Sound unter „Angeheftet an“ auf **+** klicken und die gewünschten Einträge anhaken.
- **Lösen:** Auf das **×** am Eintrag klicken.

Ein Sound kann an beliebig viele Einträge geheftet werden. Änderst du Lautstärke, Loop oder Dauer im Soundboard, gilt das automatisch für alle angehefteten Einträge.

Alternativ lässt sich im Bogen einer Waffe oder eines Zaubers über das **Noten-Symbol** in der Titelleiste auch eine eigene Audiodatei hinterlegen.

Standardmäßig darf nur der Spielleiter anheften. Mit der Einstellung **„Spieler dürfen Sounds an eigene Aktionen hängen“** geht das auch für Spieler bei ihren eigenen Charakteren.

## Sounds hinzufügen

Neue Sounds legst du als Spielleiter mit **Sound hinzufügen** an oder ziehst sie ins Soundboard: einzelne Sounds oder ganze Playlists aus der Playlist-Leiste sowie Audiodateien aus dem Dateibrowser.

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

Der Button sitzt fest oben mittig über dem Token und wird von **Ascandir - Token HUD Folders** nicht in Ordner einsortiert.
