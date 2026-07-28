# Welle Südwest — Sender-Studio

Redaktions- und Sendestudio für den Regionalradiosender „Welle Südwest" (Saarland und
Rheinland-Pfalz): Sendeplan, Nachrichten, Verkehr, Hörer-Hotline und KI-gestützte
Sprachausgabe — alles läuft eigenständig, ohne Lovable.

## KI-Funktionen (kostenlos, mit automatischen Fallbacks)

**Sprachausgabe:** läuft primär über die kostenlose Gemini-API (natürlichere, expressivere
Stimmen). Ist Gemini überlastet, das Freikontingent ausgeschöpft oder gar kein Gemini-Key
gesetzt, springt automatisch [Microsoft Edge TTS](https://github.com/travisvn/edge-tts-universal)
ein — komplett kostenlos, ohne Key, ohne Kontingent-Grenze. Die Sprachausgabe funktioniert damit
**auch ganz ohne jede Konfiguration**.

**Moderationstexte & Nachrichtenauswahl:** laufen über die kostenlose [Gemini API](https://aistudio.google.com/apikey).
Zusätzlich gibt es einen automatischen Fallback auf [Groq](https://console.groq.com/keys)
(ebenfalls kostenlos), falls Gemini gerade überlastet ist oder das Freikontingent ausgeschöpft
ist — genau die Fehlermeldung „Zu viele Anfragen – bitte kurz warten" löst automatisch den
Wechsel auf Groq aus, sofern ein Groq-Key hinterlegt ist.

1. Gemini-Key unter https://aistudio.google.com/apikey erstellen (kein Kreditkarte nötig, es
   gilt das kostenlose Free-Tier-Kontingent von Google). Ohne diesen Key läuft die Sprachausgabe
   direkt über den kostenlosen Edge-TTS-Fallback, aber Moderationstexte/Nachrichten brauchen
   mindestens Gemini oder Groq.
2. Optional, aber empfohlen: Groq-Key unter https://console.groq.com/keys erstellen (ebenfalls
   kostenlos, kein Kreditkarte nötig) — dient als Fallback nur für Texte (Moderation, Newsroom).
3. Als Umgebungsvariablen setzen (z. B. in einer lokalen `.env`-Datei):

```sh
GEMINI_API_KEY=dein-gemini-key
GROQ_API_KEY=dein-groq-key
```

Optional lassen sich die verwendeten Modelle überschreiben (z. B. wenn ein Anbieter ein Modell
abkündigt):

```sh
GEMINI_TEXT_MODEL=gemini-flash-latest           # Moderationstexte & Nachrichten
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview   # Sprachausgabe (primär)
GROQ_TEXT_MODEL=llama-3.3-70b-versatile         # Text-Fallback
```

Ohne gesetzten `GEMINI_API_KEY`/`GROQ_API_KEY` melden nur die Textfunktionen (Moderation,
Newsroom) einen Fehler — der Rest der App (Sendeplan, Bibliothek, Player, Sprachausgabe)
funktioniert trotzdem, da die Sprachausgabe immer auf den kostenlosen Edge-TTS-Fallback
zurückfällt.

## Autonomer Sendebetrieb (läuft auch ohne Besucher)

Der Sendeplan, die Musikauswahl und die Sprachausgabe laufen dauerhaft im Server-Prozess selbst
(`src/lib/server/station-engine.ts`) — unabhängig davon, ob gerade jemand das Studio oder den
Webplayer geöffnet hat. Solange der Server läuft, plant, generiert und sendet die Engine
eigenständig weiter (Musik aus dem freien Netz, Nachrichten/Verkehr aus echten Feeds, KI-Moderation).

**Wichtig für den Betrieb bei Render.com (oder jedem anderen Host):**

- Ein `npm run dev` auf dem eigenen Rechner reicht dafür **nicht** — sobald der Rechner
  aus-/einschläft oder der Prozess beendet wird, steht auch die Engine still.
- Bei Render **muss** ein Service-Typ gewählt werden, der nicht bei Inaktivität in den Schlaf
  geht: der kostenlose "Free"-Plan für Web Services pausiert nach ca. 15 Minuten ohne
  eingehende Anfragen — das würde den 24/7-Betrieb unterbrechen. Mindestens den günstigsten
  bezahlten "Starter"-Plan (oder einen "Background Worker") wählen.
- Build-Command: `npm run build`, Start-Command: `node .output/server/index.mjs`.
- Die Engine startet automatisch beim ersten eingehenden Request (z. B. Renders eigener
  Health-Check kurz nach dem Deploy) und läuft danach dauerhaft weiter.

**Player (`/player`):** Ist im Studio unter „Ausgabe" eine echte Icecast-Stream-URL hinterlegt,
spielt der Player diese ab (klassisches Webradio). Ist keine hinterlegt, „steigt" der Player
stattdessen direkt in das Sendeplan-Element ein, das die Server-Engine gerade sendet — an der
richtigen Stelle, wie beim Einschalten eines echten Radios.

**Eigener kostenloser Dauer-Stream — kein externer Anbieter nötig:** `/live-stream`
liefert einen echten, durchgehenden MP3-Stream direkt aus der Server-Engine, in Echtzeit erzeugt.
Kein Icecast-Account, kein Encoder, keine Anmeldung irgendwo nötig — einfach die URL
`https://<deine-domain>/live-stream` verwenden: direkt in VLC/einer Radio-App abspielbar,
als `<audio src="...">`, oder im Studio unter „Ausgabe" per Klick als Webplayer-Quelle setzen.
Damit dieser Stream durchgehend gültiges MP3 bleibt, nutzt die Server-Engine für ihre eigene
Sprachausgabe ausschließlich den kostenlosen Edge-TTS-Fallback (kein Gemini, kein Tageskontingent,
das den Stream unterbrechen könnte) — Gemini bleibt weiterhin die erste Wahl für die manuelle
Sprachausgabe im Studio (`/api/tts`).

**Bekannte Grenzen dieser Version:**

- Hochgeladene Musik/Jingles/Slogans/Werbespots aus der Bibliothek liegen aktuell nur im Browser
  (IndexedDB) und sind der Server-Engine dadurch nicht bekannt — sie nutzt stattdessen die freie
  Musik aus dem Netz und textbasierte Ansagen. Eigene Uploads serverseitig nutzbar zu machen
  bräuchte einen echten Datei-Speicher (z. B. S3-kompatibles Storage) und ist ein Folgeschritt.
  Werbe-Freigaben und Hörer-Hotline-Meldungen laufen dagegen bereits serverseitig und werden
  von der Engine berücksichtigt.
- Der Zustand (aktueller Sendeplan, Hotline-Meldungen, Werbe-Bewerbungen) liegt im Arbeitsspeicher
  des Server-Prozesses, nicht in einer Datenbank — bei einem Neustart/Redeploy fängt die Engine
  neu an zu planen. Für dauerhafte Historie wäre eine echte Datenbank ein sinnvoller Folgeschritt.
- Der Studio-Autopilot-Tab ist jetzt eine lokale Vorschau/manuelle Steuerung, nicht mehr die
  Quelle des echten Sendebetriebs — was wirklich „on air" ist, zeigt die neue Anzeige „Live-Sender“
  oben im Autopilot-Tab (kommt direkt vom Server).

## Entwicklung

Benötigt wird Node.js.

```sh
npm install
npm run dev
```

Weitere Skripte:

```sh
npm run build     # Produktions-Build
npm run preview   # Build lokal starten
npm run lint      # ESLint
npm run format    # Prettier
```

## Gebaut mit

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Google Gemini (Text & Sprachausgabe)
