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

## Sounds an Aktionen, Zauber und Gegenständen

Ein Sound kann automatisch abgespielt werden, sobald eine Aktion, ein Zauber, eine Fähigkeit oder ein Gegenstand benutzt wird (dnd5e).

- **Im Gegenstands- oder Zauberbogen:** Oben in der Titelleiste auf das **Noten-Symbol** klicken.
- **Im Soundboard:** Den Zauber oder Gegenstand vom Charakterbogen ins Soundboard-Fenster ziehen.

Als Sound wählst du entweder einen Sound aus dem Soundboard des Charakters oder eine eigene Datei. Lautstärke, Wiederholung und Dauer stellst du wie gewohnt ein, mit „Probehören“ hörst du ihn vorher nur für dich. Der Sound spielt am Token, der die Aktion benutzt, und ist nur in Reichweite zu hören. Im Soundboard stehen alle verknüpften Aktionen unter „Aktionen & Zauber“ und lassen sich dort auch abspielen oder stoppen.

Standardmäßig darf nur der Spielleiter Sounds an Aktionen hängen. Mit der Einstellung **„Spieler dürfen Sounds an eigene Aktionen hängen“** geht das auch für Spieler bei ihren eigenen Charakteren.

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
