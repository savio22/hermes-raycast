# Otimizações incrementais do plugin Raycast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Reduzir trabalho repetido e retenção de memória no fluxo contínuo sem alterar o transporte, a fila, o limite de 40 trocas ou os contratos visuais existentes.

**Architecture:** O turno recebe uma revisão monotônica usada por um cache LRU limitado; a tela limpa o cache ao trocar de conversa. A lista de conversas atualiza somente a primeira página em polling, deixando páginas antigas para Atualizar/manual. Cargas concorrentes de títulos e recursos cacheados compartilham promessas em voo, com limites explícitos. O retry HTTP passa a respeitar cancelamento.

**Tech Stack:** TypeScript strict, React hooks, @raycast/api, Node test runner, Raycast lint/build.

**Spec:** docs/superpowers/specs/2026-08-20-manutencao-fluxo-conversa-design.md (invariantes R1–R8) e a aprovação desta rodada registrada na conversa.

## Global Constraints

- Preservar o transporte Hermes (POST /v1/runs + eventos/consulta), a fila, o buffer de 80 ms e o teto de 40 turnos.
- Não persistir transcrições completas, credenciais, argumentos de ferramentas ou conteúdo novo fora do armazenamento já protegido.
- Não ativar polling em segundo plano; todo timer morre com a tela.
- Não alterar author, publicação, ícones, comandos ou metadados de loja.
- Não apagar nem reverter alterações pré-existentes; modificar somente os arquivos listados em cada tarefa.
- Todo comportamento novo terá teste determinístico escrito e observado falhar antes da implementação.
- Títulos devem usar no máximo 3 requisições simultâneas e sempre aceitar AbortSignal.
- O polling automático da lista deve fazer uma requisição da primeira página; páginas antigas só serão revalidadas por Atualizar/manual.

---

### Task 1: Revisão limitada das derivações e proteção de época

**Files:**
- Modify: src/lib/turns.ts
- Modify: src/lib/turn-derivations.ts
- Modify: src/hooks/use-conversation.ts
- Modify: src/components/conversation-view.tsx
- Modify: tests/performance-contract.test.ts
- Modify: tests/conversation-lifecycle.test.ts

**Interfaces:**
- Turn.revision?: number continua compatível com fixtures antigas; patchTurn incrementa a revisão somente quando o objeto do turno muda.
- createTurnDerivationCache(maxEntries?: number) usa uma entrada por turn.id, compara referência/revisão/modo/pensamento e mantém no máximo maxEntries (padrão 128), removendo o item menos recentemente usado.
- TurnDerivationCache.clear() esvazia o mapa; ConversationView chama-o quando sessionId muda.

- [ ] Step 1: Escrever testes RED. Acrescentar teste que cria 130 turnos, chama get em todos, revisita o primeiro e verifica que a derivação é refeita após o limite. Acrescentar teste que troca uma revisão ({ ...turn, revision: 1, answer: "novo" }) e verifica novo valor sem montar chave com o texto completo. Acrescentar em tests/conversation-lifecycle.test.ts um cenário de restauração de fila que resolve depois de uma troca de época e confirma que nenhum turno antigo é inserido.
- [ ] Step 2: Rodar node --test tests/performance-contract.test.ts tests/conversation-lifecycle.test.ts; confirmar falhas pelos contratos ausentes.
- [ ] Step 3: Implementar o mínimo. Adicionar revisão opcional aos turnos criados pelo servidor e pelo hook; incrementar dentro de patchTurn. Trocar keyFor baseada em message, answer e steps.join por comparação de identidade/revisão e campos pequenos (mode, thinking). Implementar LRU com Map.delete/Map.set e clear(); limpar no efeito de troca de conversa. Após await listQueuedTurns, validar cancelled, mountedRef e a época capturada antes de patch. Resetar o marcador de toast de nova conversa quando sessionId mudar.
- [ ] Step 4: Rodar os testes focados, node --test "tests/**/*.test.ts" e typecheck; só refatorar mantendo verde.

### Task 2: Deduplicação de cache e retry cancelável

**Files:**
- Modify: src/lib/storage.ts
- Modify: src/lib/hermes-api.ts
- Modify: tests/storage.test.ts
- Modify: tests/hermes-api.test.ts

**Interfaces:**
- cachedFetch compartilha uma promessa por key enquanto o loader está em voo; a entrada é removida em finally e falhas não são cacheadas.
- O atraso interno de retry aceita AbortSignal; abortar durante Retry-After rejeita imediatamente com um erro reconhecido por isAbort e não faz nova requisição.

- [ ] Step 1: Escrever testes RED. Chamar cachedFetch duas vezes antes de liberar um loader suspenso e afirmar calls === 1 e valores iguais; depois provocar rejeição e afirmar que uma nova chamada tenta novamente. Simular GET 503, abortar o sinal durante o atraso e afirmar uma única chamada ao fetch e rejeição abortável.
- [ ] Step 2: Rodar node --test tests/storage.test.ts tests/hermes-api.test.ts; confirmar falhas.
- [ ] Step 3: Implementar mapa de promessas em voo e delay(ms, signal) cancelável sem mudar regras de retry (somente GET 429/503).
- [ ] Step 4: Rodar os dois arquivos, conjunto completo e typecheck.

### Task 3: Polling barato da lista de conversas

**Files:**
- Create: src/lib/session-feed.ts
- Modify: src/sessions.tsx
- Create: tests/session-feed.test.ts

**Interfaces:**
- FeedSnapshot é { items: Session[]; hasMore: boolean; nextOffset: number; pages: number }. mergePolledFirstPage(current: FeedSnapshot, firstPage: SessionListResponse): FeedSnapshot substitui a janela mais nova, preserva itens de páginas antigas sem duplicar IDs e recalcula nextOffset sem apagar o estado já carregado.
- fetchWindow permanece para carga inicial, loadMore e Atualizar/manual; somente refresh("poll") usa listSessions({ limit: pageSize, offset: 0 }) uma vez.

- [ ] Step 1: Escrever tests/session-feed.test.ts com testes RED para a função pura: primeira página atualizada preserva a cauda antiga, remove duplicatas, mantém páginas carregadas e respeita sessões fixadas/nextSessionOffset.
- [ ] Step 2: Rodar node --test tests/session-feed.test.ts; confirmar falha por módulo ausente.
- [ ] Step 3: Implementar helper e alterar refresh: polling busca a primeira página; falha transitória mantém o feed; Atualizar/manual continua revalidando todas as páginas abertas.
- [ ] Step 4: Rodar teste focado, conjunto completo, typecheck e inspeção de que nenhum setInterval fora do efeito de primeiro plano foi criado.

### Task 4: Enriquecimento de títulos com deduplicação e limite

**Files:**
- Create: src/lib/limited-concurrency.ts
- Modify: src/active-runs.tsx
- Create: tests/limited-concurrency.test.ts

**Interfaces:**
- mapWithConcurrency<T, R>(items, limit, worker): Promise<R[]> mantém a ordem dos itens, nunca executa mais que limit workers e para corretamente em abort/erro.
- active-runs deduplica sessionId, mantém titleRequestsRef para promessas em voo, usa mapWithConcurrency(..., 3, ...), passa o AbortSignal do efeito a getSession e mantém títulos resolvidos no mapa existente.

- [ ] Step 1: Escrever teste RED que mede maxActive <= 3, preserva ordem e executa cada item único uma vez.
- [ ] Step 2: Rodar node --test tests/limited-concurrency.test.ts; confirmar falha.
- [ ] Step 3: Implementar helper e integrar o efeito de complementos sem mudar aprovação, seções ou polling de runs.
- [ ] Step 4: Rodar teste focado, conjunto completo e typecheck; verificar que cleanup não deixa setRows após desmontagem.

### Task 5: Documentação, revisão e portões

**Files:**
- Modify: README.md para explicar que páginas antigas da lista são revalidadas por Atualizar/manual, mantendo a lista cacheada utilizável.
- Modify: docs/ARCHITECTURE.md para registrar limite LRU 128, concorrência máxima 3 e polling somente da primeira página.

- [ ] Step 1: Revisar o diff e registrar no README/Architecture os três contratos alterados (LRU 128, concorrência 3 e primeira página no polling).
- [ ] Step 2: Rodar node --test "tests/**/*.test.ts".
- [ ] Step 3: Rodar typecheck do projeto e dos testes, lint Raycast, build release e git diff --check usando os binários locais disponíveis.
- [ ] Step 4: Verificar processos/portas do Hermes e executar o checklist manual somente se o servidor estiver acessível; caso contrário registrar cada cenário pendente sem simulá-lo.

## Self-review

- Task 1 cobre R1/R8 sem alterar transporte ou teto de 40.
- Task 2 mantém persistência protegida e somente compartilha chamadas cacheáveis em voo.
- Task 3 mantém paginação manual e não cria polling em segundo plano.
- Task 4 limita carga ao Hermes e preserva as ações existentes.
- Task 5 registra somente contratos reais; nenhuma alteração de loja está prevista.
