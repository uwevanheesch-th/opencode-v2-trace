# opencode-trace (für OpenCode v2)

Zeigt die rohen JSON-Requests an das LLM und die Antworten – gespeichert als interaktive HTML-Dateien in `~/opencode-trace`.

Fork von [ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace), aktualisiert für **OpenCode v2**.
So sieht der eingebettete Viewer aus: https://ljw1004.github.io/opencode-trace/example.html

---

## Voraussetzung

OpenCode **v2**. Prüfen mit:

```bash
opencode --version   # muss 2.x sein
```

## Setup (einmalig pro Rechner)

**1. Repo klonen:**

```bash
git clone https://github.com/Heaven-Rajan/ASE-Plugin-Fix.git
```

**2. Absoluten Pfad zum Klon herausfinden:**

```bash
cd ASE-Plugin-Fix && pwd
```

Die Ausgabe merken, z. B. `/Users/deinname/ASE-Plugin-Fix`.

**3. In `~/.config/opencode/opencode.json` eintragen** (Datei anlegen, falls sie nicht existiert) – mit **deinem** Pfad aus Schritt 2:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/DEIN/PFAD/ASE-Plugin-Fix"]
}
```

Wer schon eine `opencode.json` hat: einfach den `"plugins"`-Eintrag ergänzen.

**4. OpenCode-Dienst neu laden:**

```bash
opencode service restart
```

**5. Prüfen, dass es geladen ist:**

```bash
opencode plugin list     # muss "ljw1004.opencode-trace" anzeigen
```

## Benutzung

Einfach OpenCode ganz normal verwenden (in irgendeinem Projekt – **nicht** im Plugin-Ordner). Nach jedem LLM-Call entsteht eine Trace-Datei:

```bash
open ~/opencode-trace     # Ordner öffnen, .html-Datei im Browser anschauen
```

Der interaktive Viewer ist in jede HTML-Datei eingebettet.

## Updates holen

```bash
cd ASE-Plugin-Fix && git pull
opencode service restart
```

## Hinweise

- **Kein `npm install` nötig**, um das Plugin zu benutzen. `npm install` braucht ihr nur zum Entwickeln (`npm run typecheck`, `npm run lint`).
- Den **ganzen Ordner** behalten – besonders `viewer.js` neben `index.ts`. Fehlt `viewer.js`, schreibt das Plugin stillschweigend nichts.
- Der Pfad in der Config ist **pro Rechner** unterschiedlich; jede*r trägt den eigenen ein.

## Was ist anders als in v1

OpenCode v2 führt v1-Plugins nicht mehr aus. Dieses Plugin nutzt jetzt die v2-Session-Hooks `http.request` / `http.response` (statt `globalThis.fetch` zu patchen) und exportiert ein `{ id, setup }`-Plugin-Objekt.
