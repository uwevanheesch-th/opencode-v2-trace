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

## Installation

Ein einziger Befehl installiert das Plugin am festen Tag `v1.0` und trägt es in die
globale Config ein. **Kein Klonen und kein `npm install` nötig.**

```bash
opencode plugin add "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#v1.0"
```

Der Teil hinter `#` ist der Git-Ref – hier der Tag `v1.0`. Für ein späteres Update
verwendest du den jeweils angekündigten Tag (z. B. `#v1.1`).

Danach neu laden und prüfen:

```bash
opencode service restart
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

Aktualisierungen werden über einen **neuen Tag** bereitgestellt und euch explizit
angekündigt. Um zu wechseln, den alten Eintrag entfernen und den neuen Tag hinzufügen:

```bash
opencode plugin remove "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#v1.0"
opencode plugin add    "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#v1.1"
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
