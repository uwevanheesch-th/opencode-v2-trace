# opencode-v2-trace

Zeichnet die rohen JSON-Requests an das LLM und dessen Antworten auf und speichert sie
als interaktive HTML-Dateien in `~/opencode-trace`.

Fork von [ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace)
(ursprüngliches Repo), aktualisiert für **OpenCode v2** auf Basis der v2-Migration
[Heaven-Rajan/ASE-Plugin-Fix](https://github.com/Heaven-Rajan/ASE-Plugin-Fix)
(nutzt die v2-Session-Hooks statt `globalThis.fetch` zu patchen).
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
opencode plugin list     # muss "uwevanheesch-th.opencode-trace" anzeigen
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

## Konfiguration

Das Plugin wird über **Umgebungsvariablen** gesteuert – es sind keine zusätzlichen
Setup-Schritte oder Config-Dateien nötig. Ohne gesetzte Variablen greifen die Standardwerte.

### `OPENCODE_TRACE_FULL` – Voll- vs. Delta-Modus

Bei jedem Turn schickt OpenCode den **kompletten** Kontext erneut an das LLM: System-Prompt,
alle Tool-Definitionen und den gesamten bisherigen Gesprächsverlauf. Damit das aus didaktischen
Gründen sichtbar ist, protokolliert das Plugin standardmäßig **jeden Request vollständig**.

| Wert                    | Verhalten                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| *(nicht gesetzt)*       | **Vollmodus** (Standard): jeder Request wird komplett und ungefaltet geloggt |
| `OPENCODE_TRACE_FULL=0` | **Delta-Modus**: nur die Änderungen gegenüber dem vorherigen Request werden geloggt (kompaktere Dateien) |

Im Vollmodus gliedert der Viewer jeden Request zusätzlich in die Abschnitte
**System-Prompt**, **Tools** und **Verlauf**, sodass die Bestandteile eines LLM-Requests
klar erkennbar sind.

> Hinweis: Im Vollmodus wachsen die Trace-Dateien deutlich schneller, da sich der Kontext
> pro Turn wiederholt. Deshalb greift standardmäßig das Größenlimit (siehe unten).

### `OPENCODE_TRACE_MAX_MB` – Maximale Dateigröße

Begrenzt die Größe einer einzelnen Trace-Datei.

| Wert                       | Verhalten                                                      |
| -------------------------- | -------------------------------------------------------------- |
| *(nicht gesetzt)*          | **5 MB** (Standard)                                            |
| `OPENCODE_TRACE_MAX_MB=10` | Limit in MB (auch Dezimalwerte wie `2.5` möglich)             |
| `OPENCODE_TRACE_MAX_MB=-1` | **kein Limit**                                                |
| ungültiger Wert            | Rückfall auf den Standard von 5 MB (verhindert versehentlich riesige Dateien) |

Wird das Limit erreicht, schreibt das Plugin die **aktuelle Zeile noch vollständig** (der letzte
Turn bleibt intakt), hängt dann einen sichtbaren **Hinweis unten in der Datei** an und stoppt das
weitere Logging für diese Session.

Beispiel – Delta-Modus mit 20-MB-Limit:

```bash
OPENCODE_TRACE_FULL=0 OPENCODE_TRACE_MAX_MB=20 opencode run --auto "why is the sky blue?"
```

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

- Die Trace-Dateien in `~/opencode-trace` enthalten die **vollständigen, ungefilterten**
  Prompts und Antworten im Klartext. Teile sie nicht unbedacht.

---

## Was ist anders als in v1

OpenCode v2 führt v1-Plugins nicht mehr aus. Dieses Plugin nutzt die v2-Session-Hooks
`http.request` / `http.response` (statt `globalThis.fetch` zu patchen) und exportiert ein
`{ id, setup }`-Plugin-Objekt.

---

## Lizenz & Herkunft

MIT (siehe [LICENSE](./LICENSE)).

Dieser Fork beruht auf der folgenden Herkunftskette:

1. **Ursprüngliches Repo:** [ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace)
   – das Original-Plugin (für OpenCode v1, patchte `globalThis.fetch`).
2. **v2-Migration:** [Heaven-Rajan/ASE-Plugin-Fix](https://github.com/Heaven-Rajan/ASE-Plugin-Fix)
   – portierte das Plugin auf die OpenCode-v2-Session-Hooks. Auf diesem Fork beruht der v2-Code.
3. **Dieser Fork:** [uwevanheesch-th/opencode-v2-trace](https://github.com/uwevanheesch-th/opencode-v2-trace)
   – didaktische Variante (Vollmodus als Standard, Dateigrößen-Limit, nach System/Tools/Verlauf
   gegliederter Viewer). Wird per Git-Tag installiert, nicht über npm.
