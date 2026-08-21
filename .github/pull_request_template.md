## What breaks without this change

<!-- Not what the code does — what goes wrong today. -->

## What changed

<!-- The shape of the change. Link the doc in docs/ that governs it, if there is one. -->

## Gates

- [ ] `npm test`
- [ ] `npx tsc --noEmit -p tsconfig.json`
- [ ] `npx tsc --noEmit -p tests/tsconfig.json`
- [ ] `npx eslint src tests`
- [ ] `npm run lint`
- [ ] `npm run build:dist`

## Manual validation

<!--
Anything touching a live Hermes, streaming, approvals or the keyboard is not covered by the
automated suite. Say which items of docs/CHECKLIST-MANUAL.md you actually walked, on what
Windows machine, or say "none" — an honest none is fine, a silent none is not.
-->

## Checklist

- [ ] User-visible strings are in Brazilian Portuguese
- [ ] No `cmd` modifier in any shortcut
- [ ] No stop-endpoint call inside a `useEffect` cleanup
- [ ] The Hermes key is not logged, rendered or copied by any new path
- [ ] Every new action is reachable from the `Ctrl+K` action panel
- [ ] `CHANGELOG.md` updated if the change is user-visible
