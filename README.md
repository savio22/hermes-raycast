# Hermes for Raycast (Windows)

Talk to the **Hermes Agent already running on your machine** — without opening another app,
without leaving what you were doing. One shortcut, one question, the answer shows up right there.

> **Heads up on language.** The extension's entire interface — commands, screens, error messages —
> is in **Brazilian Portuguese**. This README is in English so the code is browsable by anyone, but
> the product itself is not localized yet. If you want to use it day to day, you'll want to read
> Portuguese. [README.pt-BR.md](README.pt-BR.md) is the Portuguese version of this document, and
> [ROADMAP.md](ROADMAP.md) says where i18n stands.

- **Platform:** Windows only (`"platforms": ["Windows"]` in the manifest)
- **Talks to:** `127.0.0.1` only — the Hermes API Server on your own machine. Nothing is sent to an
  external server.
- **Status:** not published on the Raycast Store yet; install from source (see
  [Development](#development)).

<!-- Demo GIF goes here once recorded: ![Demo](assets/demo.gif) -->

## The core idea: it is the *same* conversation as Hermes Desktop

This is not a second chat box living off to the side. Everything you ask here is stored in the same
place Hermes Desktop keeps its conversations.

In practice:

- You ask something from Raycast while working. Later you open Hermes Desktop and the conversation
  is there, under **Recentes**, question and answer complete.
- The reverse holds too: conversations started in Hermes Desktop show up under **Conversas do
  Hermes** and can be continued from Raycast.
- Every conversation has an **Abrir no Hermes Desktop** action that focuses that exact conversation
  in the app.

And the promise that makes this usable day to day: **closing the Raycast window cancels nothing.**
If you ask something long and the window disappears, the task keeps running inside Hermes. It comes
back in **Execuções do Hermes** with the answer ready. Only the **Parar** button actually cancels.

## Requirements

- **Windows** with [Raycast for Windows](https://www.raycast.com/windows) installed
- **Hermes Agent** running locally (the Hermes API Server must be up — default `127.0.0.1:8642`)
- **Node.js 24+**, only to build the extension from source

## Setup (no terminal required)

1. Install the extension in Raycast (from source for now — see [Development](#development)).
2. Keep **Hermes** running on this machine.
3. Open Raycast and run any Hermes command — for example **Perguntar ao Hermes**.

On first run the extension shows a welcome screen that already knows what it found: it looks for
the Hermes on this machine, discovers the right port, and states it on the first line ("Achei o
Hermes 0.20.4 aqui, em 127.0.0.1:8642") or tells you it is off. Then it is one Enter on **Detectar
configuração automaticamente**: the extension reads the local access key, tests the connection and
stores the key securely.

That Enter is deliberate. The Hermes key is a secret sitting in a file of yours, and the extension
does not go reading your files looking for secrets unless you tell it to. Discovering the **port**
is a different matter and always happens on its own.

If auto-detection finds nothing, use the **Configurar Hermes** command. It walks you through where
the Hermes config file lives, opens the folder for you, and lets you paste the key manually. The
same command fixes the configuration later — for example if the Hermes key gets rotated.

To check things are working at any time, run **Verificar conexão com Hermes**.

### About the key

The Hermes key is local: it never leaves your computer and is never sent to any external server.
The extension talks only to `127.0.0.1`. In technical details and error messages the key is always
redacted.

## Commands

Fifteen commands, all keyboard-driven. No action exists as a shortcut only — `Ctrl+K` opens the
full action list on every screen.

| Command | What it is for |
| --- | --- |
| **Perguntar ao Hermes** | Quick question, answer on the spot. Continue the conversation, branch it, rename, copy, open in Hermes Desktop. |
| **Conversas do Hermes** | List, search and continue your conversations — including the ones born in Hermes Desktop. Rename, pin, archive. |
| **Executar tarefa no Hermes** | For longer requests: shows every step through to the final result, with approval prompts when Hermes asks for permission. |
| **Execuções do Hermes** | The panel of what is in flight: follow along, answer approvals, stop, and reopen recent results. |
| **Modelos do Hermes** | See the models available in your Hermes and pick the default the extension uses. |
| **Skills do Hermes** | See which skills are enabled in your Hermes and what each one does. |
| **Ferramentas do Hermes** | See your Hermes toolsets and which ones are ready to use. |
| **Automações do Hermes** | Follow Hermes automations; pause, resume or run one right now. |
| **Perguntar sobre seleção** | Ask about the text you selected or copied, without leaving what you were doing. |
| **Resumir clipboard** | Summarize the text you just copied, as bullet points. |
| **Corrigir texto do clipboard** | Fix spelling, grammar and punctuation of copied text, no commentary. |
| **Traduzir clipboard** | Translate copied text between Portuguese and English, or into a language you name. |
| **Colar última resposta** | Paste the most recent Hermes answer into whatever app you are in. |
| **Verificar conexão com Hermes** | Diagnostics: is Hermes up? Does the key work? Which address is in use? |
| **Configurar Hermes** | Connect or reconnect the extension to Hermes, auto-detected or manual. |

### How the conversation list refreshes

While **Conversas do Hermes** is open, the 4-second poll revalidates only the first page. Older
pages you already loaded stay as they are; use the **Atualizar lista** action to revalidate that
part of the history too.

## Known limitations

Worth being honest about what is outside this version:

- **Portuguese-only interface.** Every string is pt-BR. There is no i18n layer yet.
- **Automations, skills and toolsets have screens, but availability depends on your Hermes.** An
  HTTP `501` marks Automações as unavailable — it does not hide the command or pretend the list is
  empty.
- **`jobs_admin` is off on this Hermes server** (`GET /v1/capabilities` answers
  `"jobs_admin": false`, verified on 0.20.4). That does not hide the screen: the command queries
  the real route and reports unavailability only when the server answers `501`.
- **Branching a conversation does not sync like the rest.** With **Ramificar**, Hermes creates the
  child conversation with origin `api_server`, and it **does not appear in the Hermes Desktop main
  list** (the original conversation still does). The extension warns you at that moment.
- **The default model picked in Modelos do Hermes applies to the extension only.** Hermes Desktop
  keeps its own.
- **Model providers are configured by Hermes Desktop.** If no provider is authenticated, the
  extension explains the problem but does not solve it for you.
- **Windows only, local Hermes only.** The extension talks exclusively to `127.0.0.1` and has no
  remote mode.
- **Actions that depend on a live Hermes still need manual validation per machine.** The automated
  suite covers contracts, safety, queueing, persistence and parsing; the keyboard checklist and the
  streaming/approval scenarios live in [docs/CHECKLIST-MANUAL.md](docs/CHECKLIST-MANUAL.md).
- **Voice, long-term memory and session features** exposed by Hermes have no interface here.
- **Not on the Raycast Store yet.** Until then, installing means running the developer step below
  once on this machine.

When something goes wrong, the extension always shows a message in Portuguese explaining what
happened and what to do, with **Copiar detalhes técnicos** for when you need to ask for help.

## Development

Requirements: Node.js 24+ and Raycast for Windows installed.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run lint
```

> **Windows gotcha:** the build **must** use `--target release` (every npm script here already
> does). Without it the output lands in the old Raycast X path and Raycast reports
> `Missing executable`.

Tests run on the Node.js test runner with no external framework — types are stripped by Node
itself, which is why **Node 24 is a hard requirement**. Older Node fails on the type annotations
with a syntax error that does not look like a version problem.

```bash
npm test
```

The suite currently has 291 deterministic tests. Type checking, lint and build are separate gates:

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npx tsc --noEmit -p tests/tsconfig.json
```

### Layout

- `src/lib/` — the rules: server discovery (`discovery`), HTTP client and routes (`hermes-api`),
  SSE event reading (`hermes-events`), error catalog (`errors`), state labels (`status`),
  preferences (`preferences`), local storage (`storage`) and types (`types`).
- `src/hooks/` and `src/components/` — run-tracking logic and the shared screens (approvals,
  progress, first run).
- `src/<name>.tsx` — one file per command declared in `package.json`.
- `docs/` — the documents that govern the project, in priority order:
  [`DECISOES-VERIFICADAS.md`](docs/DECISOES-VERIFICADAS.md) (decisions proven against a real
  Hermes) → [`UX-SPEC.md`](docs/UX-SPEC.md) (screens, pt-BR copy, shortcuts) →
  [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) (module contracts, error catalog, traps) →
  `docs/research/` (the API research everything rests on). These documents are written in
  Portuguese.

Two rules that are not details: **never** use the `cmd` modifier in shortcuts (Windows silently
ignores it) and **never** call a run's stop endpoint from a `useEffect` cleanup — unmounting a
screen cancels only the local reader, while the task stays alive inside Hermes.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it
covers the gates a change has to pass and the conventions this codebase actually follows.

Security issues: [SECURITY.md](SECURITY.md). Where the project is headed: [ROADMAP.md](ROADMAP.md).
What changed: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Savio Aglio (Chacal)
