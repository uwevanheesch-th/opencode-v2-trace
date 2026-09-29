# opencode-v2-trace

Zeichnet die rohen JSON-Requests an das LLM und dessen Antworten auf und speichert sie
als interaktive HTML-Dateien in `~/opencode-trace`.

Fork von [ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace),
aktualisiert für **OpenCode v2** (nutzt die v2-Session-Hooks statt `globalThis.fetch` zu patchen).
So sieht der eingebettete Viewer aus: https://ljw1004.github.io/opencode-trace/example.html

---

## Kompatibilität

| Plugin-Tag | Getestet mit OpenCode |
| ---------- | --------------------- |
| `v1.0`     | `2.0.19`              |

> Prüfe deine OpenCode-Version mit `opencode --version` (muss **2.x** sein).

---

## Installation (einfachster Weg)

Das Plugin wird als **lokaler Ordner** in die OpenCode-Config eingetragen. Es ist
**kein `npm install` nötig**, um es zu benutzen.

### 1. Repo klonen und auf den freigegebenen Tag wechseln

```bash
git clone https://github.com/uwevanheesch-th/opencode-v2-trace.git
cd opencode-v2-trace
git checkout v1.0
```

### 2. Absoluten Pfad zum Klon ermitteln

```bash
pwd
```

Merke dir die Ausgabe, z. B. `/Users/deinname/opencode-v2-trace`.

### 3. Plugin in `~/.config/opencode/opencode.json` eintragen

Lege die Datei an, falls sie nicht existiert, und trage **deinen** Pfad aus Schritt 2 ein:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/DEIN/PFAD/opencode-v2-trace"]
}
```

Wer bereits eine `opencode.json` hat: einfach den `"plugins"`-Eintrag ergänzen.

### 4. OpenCode-Dienst neu laden

```bash
opencode service restart
```

### 5. Prüfen, dass das Plugin geladen ist

```bash
opencode plugin list     # muss "ljw1004.opencode-trace" anzeigen
```

---

## Benutzung

Verwende OpenCode ganz normal in einem beliebigen Projekt (**nicht** im Plugin-Ordner
selbst). Nach jedem LLM-Call entsteht eine Trace-Datei:

```bash
open ~/opencode-trace     # Ordner öffnen, dann eine .html-Datei im Browser anschauen
```

Der interaktive Viewer ist in jede HTML-Datei eingebettet.

---

## Updates

Aktualisierungen des Plugins werden über einen **neuen Tag** bereitgestellt und
euch explizit angekündigt. Um auf einen neuen Stand zu wechseln:

```bash
cd opencode-v2-trace
git fetch --tags
git checkout v1.1        # den jeweils angekündigten Tag verwenden
opencode service restart
```

---

## Alte/kaputte Reste entfernen (Troubleshooting)

Falls du früher schon einmal `@ljw1004/opencode-trace` (oder eine ältere v1-Variante)
installiert hattest, kann OpenCode noch einen alten, fehlerhaften Eintrag laden. Symptom:
eine Meldung wie `failed to load plugin ... opencode-trace` beim Start.

So findest du **alle** Config-Quellen, die das Plugin eintragen:

```bash
opencode debug config | grep -n "path\|plugin"
```

OpenCode führt Config aus mehreren Ebenen zusammen (global **und** projektbezogen).
Entferne den Plugin-Eintrag aus **jeder** Datei, die dabei auftaucht – nicht nur aus
der globalen `~/.config/opencode/opencode.json`. Danach:

```bash
opencode service restart
opencode plugin list
```

`opencode plugin list`/`remove` betreffen nur die **globale** Config; projektbezogene
`opencode.json(c)`-Dateien musst du von Hand bereinigen.

---

## Hinweise

- **Kein `npm install` nötig**, um das Plugin zu benutzen. `npm install` brauchst du nur
  zum Entwickeln (`npm run typecheck`, `npm run lint`).
- Behalte den **ganzen Ordner** – besonders `viewer.js` neben `index.ts`. Fehlt `viewer.js`,
  schreibt das Plugin **stillschweigend nichts**.
- Der Pfad in der Config ist **pro Rechner** unterschiedlich; jede*r trägt den eigenen ein.
- Die Trace-Dateien in `~/opencode-trace` enthalten die **vollständigen, ungefilterten**
  Prompts und Antworten im Klartext. Teile sie nicht unbedacht.

---

## Was ist anders als in v1

OpenCode v2 führt v1-Plugins nicht mehr aus. Dieses Plugin nutzt die v2-Session-Hooks
`http.request` / `http.response` (statt `globalThis.fetch` zu patchen) und exportiert ein
`{ id, setup }`-Plugin-Objekt.

---

## Lizenz & Herkunft

MIT (siehe [LICENSE](./LICENSE)). Ursprüngliches Projekt:
[ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace).
v2-Migration basierend auf [Heaven-Rajan/ASE-Plugin-Fix](https://github.com/Heaven-Rajan/ASE-Plugin-Fix).
