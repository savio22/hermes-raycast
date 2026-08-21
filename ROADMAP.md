# Roadmap

Where this project is and where it is going. Not a release schedule — a statement of priorities, so
that nobody has to guess whether a missing thing is missing on purpose.

Current state: 15 commands shipped, 291 automated tests, no Raycast Store listing yet.

## Next

**Publish on the Raycast Store.** The blocking item is that the store lints command and preference
titles for Title Case, and every title here is a Portuguese sentence. Fourteen warnings, all from
that. This has to be resolved as a naming decision before submission, not silenced.

**Demo GIF and screenshots.** A UI product with no picture in its README is asking a lot of a
reader.

**Decide on i18n.** Today every user-visible string is Brazilian Portuguese, hard-coded at the call
site. An English UI means introducing a real string layer, not sprinkling ternaries. Two honest
options: adopt i18n as actual work, or stay pt-BR and say so up front — which is what the README
does now. The decision is open.

**Long-conversation performance.** The derivation cache is a fixed 128-entry LRU while the render
cap grows in steps of 40 with no ceiling. Conversations past roughly 160 exchanges will start
thrashing it. This is a known shape, not a bug, and it deserves a measurement before anyone changes
a number.

**Close the manual-validation gap.** Streaming, approvals and every keyboard flow live in
[`docs/CHECKLIST-MANUAL.md`](docs/CHECKLIST-MANUAL.md) and are walked by hand — the Raycast window
is not visible to screen automation on Windows, so no amount of test-writing removes this step.
Anything that can be pulled out of the checklist into a contract test should be.

## Later

- **Attachments and images**, once the API's multimodal format is verified rather than assumed.
- **Deeplinks** into extension commands.
- **A Raycast AI tool**, so Raycast's own AI can call controlled Hermes capabilities.
- **Optional remote Hermes support.** Today the extension talks to `127.0.0.1` and nothing else,
  and that constraint is doing real security work. Loosening it is a design problem first.
- **Optional macOS support**, only if it costs the Windows experience nothing. The manifest is
  `"platforms": ["Windows"]` deliberately.

## Not planned

- Reproducing all of Hermes Desktop. This is a compact interface to Hermes, not a second client.
- Editing Hermes' internal configuration, authenticating providers, or installing anything.
- Any destructive action without an explicit approval step.
- A generic framework layer built ahead of a validated command.

## Depends on Hermes, not on this extension

Listed so nobody spends a weekend on them here:

- **Branching does not sync like the rest.** Hermes creates the child conversation with origin
  `api_server`, and it does not show in the Hermes Desktop main list. The extension warns about it;
  fixing it means changing Hermes.
- **`jobs_admin` availability.** When the server answers `501`, Automações reports unavailable.
  That is the server's answer, not a gap in the screen.
- **Voice, long-term memory and session features** exposed by Hermes have no interface here yet,
  and their shape is set upstream.
