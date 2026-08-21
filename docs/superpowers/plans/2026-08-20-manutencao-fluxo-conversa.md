# Manutenção do fluxo de conversa contínua Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o fluxo de conversa contínua recuperável, serializado, visualmente verdadeiro e seguro sob interleavings, fechamento/reabertura, filas e entradas grandes.

**Architecture:** Extrair contratos puros para contexto/época, transições de run, derivação visual e entrada delimitada. O hook `useConversation` consumirá esses contratos com um scheduler serializado; `storage.ts` fornecerá índice V2 migrável, mutex por chave, retry limitado e persistência da fila. A UI existente receberá somente estados/diagnósticos já classificados e copy do catálogo.

**Tech Stack:** TypeScript strict, React hooks, `@raycast/api` LocalStorage/Cache, Node test runner, Raycast lint/build.

**Spec:** `docs/superpowers/specs/2026-08-20-manutencao-fluxo-conversa-design.md`

## Execução registrada — 2026-08-20

- Implementação aplicada no checkout existente, preservando alterações anteriores do usuário.
- Gates automatizados finais antes desta rodada: `npm test` (265 testes passando), `npm run typecheck`, `npm run lint` e `npm run build` passaram. Após as duas regressões de interleaving, o conjunto passou a 267 testes.
- O lint mantém somente os avisos preexistentes de Title Case no `package.json`.
- O checklist Windows/Raycast permanece manual e não foi marcado como executado sem validação visual real.
- Em 2026-08-20 foram adicionados testes e correções para: (a) manter o `sessionId` capturado
  antes de `resolveModelChoice()` e (b) esconder `Continuar esta conversa` enquanto a execução
  não for terminal. Ver `D-13` e `D-14` em `docs/DECISOES-VERIFICADAS.md`.
- O harness de hook previsto na lacuna original foi coberto pelos contratos puros de época, reducer, fila e promessas controladas; os cenários de UI continuam listados em `docs/CHECKLIST-MANUAL.md`.
- As caixas de seleção abaixo preservam o rastreio granular do plano original. O estado confiável desta execução está no registro acima e nos gates verificáveis; itens de validação visual/manual não são marcados sem execução real no Raycast e no Hermes.

## Global Constraints

- Preservar R1–R8 e o transporte existente (`POST /v1/runs` + eventos/consulta); não mudar o contrato do Hermes.
- Nenhuma alteração visual/mobile; a extensão continua Windows-first e PC-first.
- Nunca registrar credenciais, prompts completos, respostas completas ou argumentos de ferramentas.
- Toda função nova/alterada nasce de teste determinístico que falha primeiro; interleavings não usam `setTimeout` real.
- Registros de run aceitos são idempotentes por `runId`; runs não terminais nunca são removidas por retenção.
- Textos visíveis usam o vocabulário de `docs/UX-SPEC.md`; strings proibidas só podem existir em comentários/logs/testes técnicos.

### Task 1: Contratos puros de lifecycle e entrada

**Files:**
- Create: `src/lib/conversation-lifecycle.ts`
- Create: `tests/conversation-lifecycle.test.ts`
- Modify: `src/lib/types.ts` (exportar `TransportPhase`, `RunDiagnostic`, `StoredQueuedTurn` quando necessário)

**Interfaces:**
- `ConversationContext = { epoch: number; sessionId?: string; turnId: string; runId?: string }`.
- `nextConversationEpoch(previous: number): number` e `isCurrentContext(current, captured): boolean`.
- `RunTransitionState`/`RunTransitionEvent` e `reduceRunTransition(state, event)`; reducer puro bloqueia segunda run viva.
- `createControlledPromise<T>()` para testes de suspensão sem timers.
- `truncatePreservingEnds(text, limit, marker)` com corte Unicode-safe e resultado `{text, truncated, originalLength}`.
- `delimitUntrustedContent(text)` para prompts de clipboard.

- [ ] Step 1: Escrever testes RED para época/contexto, transições `queued→…→terminal`, dois envios no mesmo tick, truncamento de emoji/início/fim e delimitação.
- [ ] Step 2: Rodar `node --test tests/conversation-lifecycle.test.ts`; confirmar falha por exports ausentes.
- [ ] Step 3: Implementar tipos, reducer e helpers mínimos, sem dependências de React/Raycast.
- [ ] Step 4: Rodar o arquivo focado e depois `npm test`; refatorar apenas mantendo verde.

### Task 2: Índice V2, fila durável e escrita concorrente

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `tests/storage.test.ts`

**Interfaces:**
- `StoredRunV2` com `schemaVersion: 2`, `status`, `transportPhase`, `updatedAt`, `baseUrl`, `expired`.
- `StoredQueuedTurnV1` e chaves compatíveis para fila por conversa.
- `rememberRun`, `updateStoredRun(s)`, `saveQueuedTurn`, `removeQueuedTurn`, `listQueuedTurns` idempotentes e serializados por chave.
- Migração automática dos registros atuais sem pedir nova ação ao usuário.
- Retry limitado de LocalStorage com backoff injetável em testes; falha final lança erro acionável e registra pendência quando possível.

- [ ] Step 1: Adicionar fixtures do formato atual, 202 aceito, falha de armazenamento, duas gravações simultâneas, run ativa sob retenção e fila por conversa.
- [ ] Step 2: Rodar os testes focados para observar as falhas esperadas.
- [ ] Step 3: Implementar mutex/fila por chave, migração V1→V2, retenção por idade/tamanho sem expulsar não terminais e retry limitado.
- [ ] Step 4: Rodar `node --test tests/storage.test.ts`; confirmar que testes antigos e novos passam.

### Task 3: Scheduler serializado e identidade do hook

**Files:**
- Modify: `src/hooks/use-conversation.ts`
- Modify: `src/lib/turns.ts`
- Create: `tests/use-conversation.lifecycle.test.ts` (harness de hook com módulos Raycast controlados)

**Interfaces:**
- `runTurn` captura contexto imutável antes do primeiro `await`; todo patch assíncrono valida época + `turnId`/`runId`.
- `switchSession` incrementa época, aborta apenas leitores locais e nunca altera a run antiga.
- Scheduler consome snapshot/reducer único e garante no máximo uma criação viva por conversa.
- `send`, `stop`, `steer`, `reattach` e `retry` resolvem alvos pelo contexto do turno, não por refs globais trocáveis.
- Registro mínimo da run ocorre imediatamente após o retorno 202, antes de pintura/stream/cache; falha de persistência fica visível.
- Reabertura reanexa runs não terminais e restaura fila sem disparar segunda run.

- [ ] Step 1: Criar testes RED para troca durante `resolveModelChoice`, troca após 202 antes do primeiro evento, dois `send` no mesmo tick, `stop` pendente, stop+novo envio, retry explícito e reanexação.
- [ ] Step 2: Rodar apenas o novo arquivo; confirmar falhas de interleaving.
- [ ] Step 3: Extrair/adaptar scheduler e epoch no hook; substituir varredura distribuída por transição serializada; integrar storage V2.
- [ ] Step 4: Rodar testes focados e `npm test`; corrigir regressões sem relaxar invariantes.

### Task 4: Estado visual, diagnóstico, autorização e copy

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/jobs.tsx`
- Modify: `src/lib/turns.ts`
- Modify: `src/hooks/use-conversation.ts`
- Modify: `src/components/conversation-view.tsx`
- Modify: `src/components/first-run.tsx`, `src/lib/preferences.ts`, `src/lib/discovery.ts`, `src/session-detail.tsx`
- Create: `tests/ui-contracts.test.ts`

**Interfaces:**
- Separar `runStatus`, `transportPhase` e `diagnostic`; “nunca enviada” depende apenas de `not_sent`.
- `mapHttpError` converte 401 em `/api/jobs*` para `HermesNotConfiguredError`; 501 permanece indisponibilidade e rede permanece recuperável.
- Catálogo de copy central/scan de strings proíbe termos técnicos visíveis.
- Run concluída com aviso de autenticação permanece `completed`, com diagnóstico separado.

- [ ] Step 1: Escrever testes RED para completed+diagnostic, 401 de Automações em `NotConfigured` e scan de vocabulário.
- [ ] Step 2: Rodar testes focados e confirmar falhas.
- [ ] Step 3: Implementar mapeamento, tipos/derivações e substituir strings visíveis fora do catálogo.
- [ ] Step 4: Rodar `npm test`, lint focado e revisar snapshots/string scan.

### Task 5: Performance de render e derivações

**Files:**
- Modify: `src/components/conversation-view.tsx`
- Modify: `src/hooks/use-conversation.ts`
- Modify: `src/lib/turns.ts`
- Create: `tests/performance-contract.test.ts`

**Interfaces:**
- Linha de turno memoizada por `turn.id`/versão; markdown, metadata e ações não recalculam turnos antigos.
- Assinatura pequena (`liveTurnId`, `queueVersion`, `lastTerminalStatus`, contagem) substitui scans completos.
- Contador de renders/tempo de derivação ativo somente em ambiente de teste/desenvolvimento.

- [ ] Step 1: Escrever testes RED com 40 turnos e deltas frequentes, verificando que só o turno vivo deriva.
- [ ] Step 2: Rodar o teste focado e confirmar falha.
- [ ] Step 3: Implementar memoização/assinaturas estáveis sem mudar layout.
- [ ] Step 4: Rodar teste focado, `npm test` e typecheck.

### Task 6: Clipboard, Unicode, tradução e toolsets

**Files:**
- Modify: `src/components/text-command.tsx`
- Modify: `src/ask-selection.tsx`, `src/summarize-clipboard.tsx`, `src/fix-clipboard.tsx`, `src/translate-clipboard.tsx`
- Modify: `src/skills.tsx`, `src/toolsets.tsx`
- Create: `src/lib/input-safety.ts`
- Create: `tests/input-safety.test.ts`

**Interfaces:**
- `capture` aplica `truncatePreservingEnds` antes do envio, preserva surrogate pairs e mostra marcador/contador.
- Prompts delimitam clipboard como conteúdo não confiável e instruem não executar comandos/instruções internas.
- Tradução explícita vence inferência; casos mistos/curtos expõem direção inferida para confirmação.
- Ação de configurações aponta para o destino real de skills/ferramentas ou explica honestamente a limitação.

- [ ] Step 1: Escrever testes RED para emoji, preservação do fim, marcador/contador, prompt injection, idioma explícito e caso ambíguo.
- [ ] Step 2: Rodar teste focado e confirmar falha.
- [ ] Step 3: Implementar helpers e integrar nas quatro superfícies, mantendo cache-first/TTL.
- [ ] Step 4: Rodar testes focados e `npm test`.

### Task 7: Portões finais e checklist Windows

**Files:**
- Modify: `docs/CHECKLIST-MANUAL.md` se necessário para refletir os cenários da spec
- Modify: `README.md` somente para limitações verificadas, sem segredos

- [ ] Step 1: Rodar `npm test` completo e registrar contagem/resultado.
- [ ] Step 2: Rodar `npm run typecheck`, `npm run lint` e `npm run build` completos.
- [ ] Step 3: Executar checklist manual Windows: fechar/reabrir, troca durante escolha/stream, dois envios, parar em três fases, aprovação pendente, retenção, 401/404/rede/Hermes desligado, Automações sem configuração, 40 turnos e clipboard hostil.
- [ ] Step 4: Revisar diff/status Git, confirmar que nenhuma alteração pré-existente do usuário foi apagada e documentar lacunas reais.

## Self-review

- R1: Task 3 (epoch/contexto e testes de troca).
- R2: Task 2+3 (índice V2, mutex/retry e registro após 202).
- R3: Task 1+3 (reducer/scheduler e interleavings de fila/stop/retry).
- R4: Task 2+3 (fila, reanexação, retenção e persistência incremental).
- R5: Task 4 (campos separados e diagnóstico).
- R6: Task 4 (401/501/rede e primeiro uso).
- R7: Task 4 (catálogo/string scan).
- R8: Task 5 (memoização e métricas locais).
- Fase 2: Task 6 (delimitação, Unicode, tradução, toolsets).
- Portões: Task 7. Não há placeholders ou dependências indefinidas.
