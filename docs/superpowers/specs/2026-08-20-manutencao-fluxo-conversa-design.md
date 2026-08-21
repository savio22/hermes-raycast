# Manutenção do fluxo de conversa contínua

**Data:** 2026-08-20  
**Estado:** aprovada e implementada incrementalmente  
**Precedência:** complementa `docs/superpowers/specs/2026-08-19-conversa-continua-design.md`.
Não altera as decisões verificadas em `docs/DECISOES-VERIFICADAS.md` nem reabre o desenho
visual da conversa. Quando houver conflito, as decisões verificadas e o desenho aprovado
continuam vencendo; este documento define correções de confiabilidade, manutenção,
performance e segurança.

## 1. Resultado esperado

O usuário deve conseguir fechar e reabrir o Raycast sem perder uma execução aceita, trocar
de conversa sem mandar uma pergunta para o destino errado e enviar várias mensagens sem
criar duas execuções simultâneas na mesma conversa. O estado mostrado deve ser verdadeiro:
uma resposta concluída não pode aparecer como “nunca enviada”, e uma automação sem acesso
deve voltar à tela de primeiro uso.

O trabalho será executado de forma incremental, com testes determinísticos antes de cada
mudança de lifecycle. A extensão continuará Windows-first, usando o transporte existente
(`POST /v1/runs` + acompanhamento por eventos/consulta), sem mudar o contrato do Hermes
por conveniência da extensão.

## 2. Contexto verificado

Na revisão atual, os portões abaixo passaram antes desta spec ser criada:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Os testes cobrem funções puras de `src/lib/turns.ts`, armazenamento, conversão de erros e
interleavings essenciais do lifecycle. A validação visual do Raycast continua no checklist manual.

### 2.1 Problemas de prioridade

| Prioridade | Problema | Evidência/área | Resultado de manutenção |
|---|---|---|---|
| P0 | Uma troca de conversa durante um `await` pode deixar a resposta antiga escrever na conversa nova. | `use-conversation.ts`, criação do turno e `switchSession` | Barreira de identidade/época para todo efeito assíncrono. |
| P0 | Depois de o servidor aceitar a run, uma falha no caminho de persistência pode deixar o `run_id` fora do índice local. | `use-conversation.ts`, `rememberRun`; `storage.ts` | Registro imediato, retentativa e reconciliação sem duplicar. |
| P0 | Ação de continuar/reanexar e abertura da conversa não têm uma regra única para runs ainda ativas. | `run-progress.tsx`, `use-conversation.ts`, `active-runs.tsx` | Uma única fonte de verdade para run ativa por conversa. |
| P1 | Envios consecutivos, `Parar` seguido de novo envio e varredura da fila podem produzir decisões com estado defasado. | efeitos da fila e `turns.ts` | Transições puras e serializadas; no máximo uma run viva. |
| P1 | A fila local e a indexação limitada podem perder trabalho ao fechar a janela ou após muitas runs. | `storage.ts`, `use-conversation.ts` | Persistir fila e nunca expulsar uma run ativa. |
| P1 | Uma resposta concluída com aviso de autenticação do provedor recebe `error` e pode cair no texto “nunca enviada”. | `use-conversation.ts`, `turns.ts` | Separar estado terminal de diagnóstico da resposta. |
| P1 | HTTP 401 em Automações não cai na tela de primeiro uso. | `jobs.tsx` | Mapear autenticação/configuração antes do `EmptyView` genérico. |
| P1 | Há textos visíveis fora do vocabulário aprovado. | `first-run.tsx`, `preferences.ts`, `discovery.ts`, `session-detail.tsx`, `errors.ts` | Catálogo central de copy e teste de palavras proibidas. |
| P2 | A lista recalcula trabalho de todos os turnos a cada atualização do turno vivo. | `conversation-view.tsx`, `use-conversation.ts` | Derivações memoizadas e atualização limitada ao turno afetado. |
| P2 | Fase 2 ainda precisa de limites e entradas não confiáveis mais explícitos. | `text-command.tsx` e comandos de clipboard | Contratos seguros para truncamento, tradução e toolsets. |

Os itens de concorrência foram confirmados por testes de interleaving e protegidos por
contratos puros. O checklist manual ainda distingue o que foi exercitado no Raycast real.

## 3. Escopo e não escopo

### 3.1 Incluído

- lifecycle de conversa, turno, run e stream;
- fila local, `Parar`, `Tentar novamente`, reanexação e troca de conversa;
- índice local, aprovações pendentes, resultado terminal e migração do formato salvo;
- estados e mensagens visíveis, inclusive Automações e tela de primeiro uso;
- renderização da lista e custo das derivações;
- entrada de clipboard, truncamento e delimitação de conteúdo não confiável;
- testes automatizados e checklist manual Windows.

### 3.2 Não incluído

- redesign da tela aprovado na spec de 2026-08-19;
- migração para outro endpoint de streaming;
- mudança de credenciais ou ativação de provedores;
- alteração do comportamento Pix/Stone de outros projetos;
- suporte mobile nesta fase;
- telemetria que envie prompts, respostas, chaves ou argumentos de ferramentas.

## 4. Invariantes obrigatórias

Estas regras são contratos de implementação e de teste. Se uma alteração não consegue
preservá-las, ela deve parar no design antes de entrar no código.

### R1 — Identidade da tela vence qualquer resultado antigo

Cada montagem e cada troca de conversa recebe um `conversationEpoch` monotonicamente
crescente. Um turno captura, antes do primeiro `await`, um contexto imutável contendo:
`epoch`, `sessionId`, `turnId` e, quando existir, `runId`.

- Resultado assíncrono antigo pode concluir e ser persistido para sua própria run, mas não
  pode alterar `turns`, `runId`, `approval`, `stopRequested`, título ou modelo da tela
  atual.
- `switchSession` invalida a época anterior e aborta somente os leitores locais. A tarefa
  no Hermes continua viva, conforme D-02.
- `Parar`, `Orientar execução` e `Acompanhar de novo` devem resolver o alvo pelo
  `turnId`/`runId` do contexto atual, nunca por um ref global que possa ter sido trocado.
- O teste de troca deve inserir um `Promise` suspenso em `resolveModelChoice`, antes de
  `askInSession`/`startConversation`, e verificar que nenhum campo da nova conversa muda.

### R2 — Run aceita é run recuperável

O primeiro resultado 202 que contém `run_id` inicia uma transação lógica:

1. o endpoint efetivo já deve estar resolvido no contexto do transporte;
2. o registro mínimo da run é gravado imediatamente, sem outro `await` opcional entre
   resposta e persistência;
3. só depois começam pintura, acompanhamento, cache de resultado e efeitos secundários.

O registro deve ser idempotente por `runId`. Se o `LocalStorage` falhar, o código deve
   retentar com backoff limitado, manter uma marca local de escrita pendente quando for
   possível e exibir uma mensagem acionável; nunca fingir que a execução não existe.
   Como não há `GET /v1/runs`, a impossibilidade de gravar o índice é uma falha de
   recuperação que precisa ser visível e testada, não escondida em `catch` vazio.

As operações de leitura-modificação-gravação do índice devem passar por um mutex por
chave (ou fila equivalente), para que atualizações de duas runs não se sobrescrevam.

### R3 — Uma única run viva por conversa

O motor deve ter uma transição serializada e pura para:

`queued → starting → accepted → running/waiting_for_approval → stopping → terminal`.

`failed`, `cancelled` e `expired` são terminais. Uma nova mensagem sempre entra como
`queued`; somente o scheduler, depois de observar o estado confirmado, pode movê-la para
`starting`.

- Em nenhum instante duas mensagens da mesma conversa podem chamar `POST /v1/runs`.
- Dois `send()` no mesmo tick devem gerar dois turnos distintos e uma única decisão de
  scheduler: o primeiro é iniciado; o segundo permanece na fila.
- A varredura que cancela a fila deve consumir o mesmo snapshot/reducer do scheduler,
  nunca um `turnsRef` que possa estar defasado.
- Depois de `Parar`, mensagens novas são aceitas. Só itens que já estavam bloqueados pela
  falha/cancelamento anterior recebem `Cancelado`; uma pergunta nova e explícita não pode
  ser descartada.
- `Tentar novamente` é a única ação que fura a regra “não iniciar depois de falha”.

### R4 — Fechar e reabrir não perde trabalho local

O estado que o servidor não consegue devolver deve ser gravado a cada alteração relevante,
e não depender de uma gravação assíncrona no momento da desmontagem:

- fila de mensagens ainda não aceitas;
- associação `conversationId → turnId → runId`;
- aprovação recebida e ainda não resolvida;
- último estado conhecido e resultado terminal truncado.

Ao reabrir uma conversa, o hook deve carregar mensagens do servidor e depois reanexar
qualquer run não terminal registrada para aquela conversa. A reanexação não dispara uma
segunda run. Runs expiradas permanecem distinguíveis de “Falhou” e deixam de bloquear a
fila.

Ao trocar de conversa com fila local, pedir confirmação antes de descartar itens. O texto
da barra pode sobreviver como rascunho, mas nunca pode ser enviado para a conversa nova
sem uma ação explícita.

### R5 — Estado visual não mistura resultado com diagnóstico

O contrato deve separar:

- `runStatus`: `queued`, `running`, `waiting_for_approval`, `stopping`, `completed`,
  `cancelled`, `failed`;
- `transportPhase`: `not_sent`, `starting`, `accepted`, `streaming`, `reconciling`;
- `diagnostic`: autenticação do provedor, queda de conexão, expiração ou outro detalhe.

“Nunca enviada” só pode aparecer quando `transportPhase === "not_sent"`. Uma run
`completed` com texto de aviso do provedor continua concluída; o diagnóstico explica a
ação necessária sem reclassificar a resposta como falha de envio.

### R6 — Primeiro uso e autorização têm caminho próprio

Para Automações, `HermesNotConfiguredError` e HTTP 401 devem renderizar `NotConfigured`
com a ação de detecção/configuração. 501 continua sendo “automação indisponível neste
Hermes”; falhas de rede continuam sendo erro recuperável com `Atualizar lista`.

O mapeamento deve ser centralizado em `toHermesError`/guardas de tela, sem duplicar
comparações de status HTTP em cada comando.

### R7 — Vocabulário de produto é uma API de UI

Textos visíveis devem usar “conversa”, “mensagens”, “execução”, “configurações”,
“ferramentas” e “automação”, conforme `docs/UX-SPEC.md`. Não usar “histórico”, “API”,
“endpoint”, “token”, “SSE”, “JSON”, “stream”, “run”, “session”, “chat” ou “thread” em
labels, títulos, descrições, toasts e EmptyViews.

Exceções permitidas: nomes técnicos em documentação interna, logs de desenvolvimento e
identificadores de código que não chegam à interface.

### R8 — Atualização barata por padrão

O turno vivo pode atualizar no máximo uma vez por janela de 80 ms. Cada atualização deve
recalcular apenas texto, etapas e estado do turno afetado.

- Extrair uma linha de turno memoizada, com props estáveis para turnos antigos.
- Memoizar markdown, metadata, `usedTools` e ações por `turn.id`/versão do turno.
- Trocar varreduras completas por uma assinatura pequena: `liveTurnId`, `queueVersion`,
  `lastTerminalStatus` e contagem de turnos.
- Manter o teto de renderização de 40 turnos e a paginação do servidor separados.
- Medir renderizações e tempo de derivação em teste/desenvolvimento; não adicionar
  telemetria de conteúdo.

## 5. Contrato local sugerido

O formato deve ser versionado e migrável sem apagar dados existentes.

```ts
type TransportPhase = "not_sent" | "starting" | "accepted" | "streaming" | "reconciling";

interface StoredRunV2 {
  schemaVersion: 2;
  runId: string;
  sessionId?: string;
  turnId: string;
  promptPreview: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  transportPhase: TransportPhase;
  lastKnownEvent?: string;
  baseUrl: string;
  expired?: boolean;
}

interface StoredQueuedTurnV1 {
  schemaVersion: 1;
  id: string;
  sessionId?: string;
  message: string;
  createdAt: number;
}
```

Regras do índice:

- nunca podar uma run não terminal;
- aplicar retenção a terminais por idade/tamanho, preservando pelo menos o período já
  prometido pela interface;
- não depender de um cap fixo de 20 para recuperação;
- migrar registros antigos sem exigir nova pergunta do usuário;
- remover aprovação/resultado somente quando a run estiver terminal e o registro puder
  ser descartado com segurança.

O nome exato das chaves pode permanecer compatível com `StorageKeys`; a migração deve
ser testada com fixtures do formato atual.

## 6. Fase 2: segurança e qualidade de entrada

### 6.1 Texto copiado é dado, não instrução

Prompts de resumir, corrigir, traduzir e perguntar sobre seleção devem delimitar o texto
copiado como conteúdo não confiável, instruindo o modelo a não executar comandos nem
seguir instruções encontradas dentro dele. O texto original deve continuar preservado
para o usuário; a delimitação é somente do prompt enviado.

### 6.2 Limite de 20.000 caracteres

O limite é aplicado antes do envio e comunicado claramente. O corte deve ser seguro para
Unicode (não separar surrogate pair/emoji) e, para textos muito longos, preservar início e
fim com um marcador explícito em vez de remover silenciosamente a conclusão. O contador e
o marcador devem ser cobertos por teste.

### 6.3 Tradução

Manter a conveniência automática PT↔EN quando a detecção tiver confiança suficiente.
Para texto misto, curto ou de outro idioma, mostrar a direção inferida e permitir
confirmação/alteração antes do envio. O argumento `idioma` explícito continua vencendo a
inferência.

### 6.4 Skills e ferramentas

O carregamento permanece cache-first, com TTL e corte já definidos para não pressionar o
servidor. A ação “Abrir configurações” deve abrir o destino que realmente configura
skills/ferramentas (Hermes Desktop, quando aplicável), ou explicar de forma honesta que a
configuração fica em outro lugar.

## 7. Ordem de implementação

### Fase 0 — Portões e testes de lifecycle

- extrair transições puras e tipos de contexto;
- criar helpers de promessa controlada para interleavings;
- adicionar fixtures de índice antigo, 202 aceito e 401;
- registrar métricas locais de contagem de renders apenas em ambiente de teste.

**Saída:** testes falhando para cada requisito R1–R8, sem mudança visual.

### Fase 1 — Identidade e persistência P0 (**implementada**)

- implementar `conversationEpoch`/contexto imutável;
- resolver o endpoint no contexto da criação e gravar a run imediatamente após 202;
- adicionar mutex/retry de índice;
- garantir que resultados antigos só atualizem sua própria run;
- corrigir reanexação/“continuar” para distinguir terminal de não terminal.

**Saída:** os três P0 têm testes de regressão determinísticos e não há run aceita sem
registro recuperável quando o armazenamento está disponível.

### Fase 2 — Scheduler e fila P1 (**implementada**)

- substituir decisões distribuídas entre efeitos por reducer/scheduler serializado;
- testar dois envios no mesmo tick, envio durante `stopping`, retry explícito e falha;
- persistir itens enfileirados e restaurá-los por conversa;
- impedir que uma run ativa seja removida por retenção.

**Saída:** no máximo uma chamada de criação viva por conversa em qualquer cenário testado.

### Fase 3 — Verdade visual e autorização

- separar `runStatus`, `transportPhase` e `diagnostic`;
- corrigir “nunca enviada” e E22;
- mapear 401 de Automações para `NotConfigured`;
- centralizar copy e substituir vocabulário proibido.

**Saída:** catálogo de estados e mensagens aprovado por teste de snapshot/string scan e
checklist manual.

### Fase 4 — Performance

- memoizar linha/ações/detalhe;
- reduzir assinaturas e scans por atualização;
- validar com 40 turnos e um turno emitindo texto a cada 80 ms.

**Saída:** nenhum cálculo de todos os turnos por delta, salvo justificativa medida; build
sem regressão e navegação por teclado fluida no Windows.

### Fase 5 — Fase 2

- delimitação de clipboard;
- truncamento Unicode-safe com início/fim;
- confirmação de direção de tradução em casos ambíguos;
- destino correto de configurações de ferramentas.

**Saída:** testes de conteúdo não confiável, Unicode, detecção ambígua e cache/timeout.

## 8. Testes de aceitação

### 8.1 Testes unitários/puramente determinísticos

Adicionar testes para:

1. troca de conversa enquanto `resolveModelChoice` está suspenso;
2. troca depois de `askInSession` aceitar a run, antes do primeiro evento;
3. falha de endpoint/persistência logo após 202, com retentativa e deduplicação;
4. duas mensagens enviadas no mesmo tick;
5. `Parar` enquanto a criação está pendente;
6. `Parar` seguido imediatamente de nova mensagem;
7. retry explícito depois de falha/cancelamento;
8. reabertura com run não terminal e fila persistida;
9. duas atualizações simultâneas do índice sem perda de patch;
10. run ativa não removida por retenção;
11. `run.completed` com diagnóstico de provedor sem “nunca enviada”;
12. 401 de Automações renderizando primeiro uso;
13. scan de copy sem palavras proibidas em textos visíveis;
14. truncamento de emoji e preservação do final;
15. conteúdo copiado delimitado como não confiável;
16. tradução explícita vencendo inferência.

### 8.2 Portões de código

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Nenhum portão pode ser substituído por inspeção estática. Warnings de Title Case só são
aceitos quando já previstos pela configuração e não forem texto proibido de produto.

### 8.3 Checklist manual Windows

- abrir conversa, enviar, fechar Raycast e reabrir;
- trocar de conversa durante escolha de modelo e durante stream;
- enviar duas mensagens rapidamente;
- parar no instante inicial, durante stream e aguardando aprovação;
- reabrir uma aprovação pendente;
- ultrapassar a retenção terminal e confirmar que runs ativas continuam visíveis;
- provocar 401, 404/expirada, queda de conexão e Hermes desligado;
- abrir Automações sem configuração;
- usar 40 turnos e observar seleção, detalhes e teclado;
- testar clipboard com emoji, texto misto, 20.000+ caracteres e instruções maliciosas.

## 9. Critérios de aceite do documento

A manutenção só pode ser considerada concluída quando:

1. R1–R8 têm implementação ou justificativa explícita de bloqueio;
2. os testes de interleaving passam sem depender de `setTimeout` real;
3. nenhum 202 aceito fica sem caminho de recuperação quando o armazenamento está
   disponível;
4. a fila garante uma única run viva por conversa;
5. uma reabertura reanexa em vez de duplicar;
6. estados e textos respeitam o catálogo aprovado;
7. os limites de render e de entrada são medidos;
8. os quatro portões e o checklist Windows passam;
9. a revisão visual confirma que a tela continua PC-first e que nenhuma mudança mobile foi
   introduzida.

## 10. Riscos e decisões abertas

| Risco | Tratamento |
|---|---|
| `LocalStorage` indisponível ou falhando repetidamente | Retentativa limitada, mensagem acionável e diagnóstico sem dados sensíveis; não prometer recuperação impossível sem armazenamento. |
| Não existe listagem remota de runs | O índice local continua obrigatório; mudanças devem evitar qualquer janela entre 202 e registro. |
| Atualização do índice por várias telas | Mutex compartilhado e teste de concorrência; não confiar apenas em `updateStoredRuns` local ao componente. |
| Custo de 40 painéis no host Raycast | Medir antes de baixar o teto; manter 40 como limite de produto até haver evidência. |
| Tradução de texto misto | Confirmar direção quando a confiança for baixa; nunca sobrescrever pedido explícito. |
| Conteúdo copiado com prompt injection | Delimitação e instrução de não execução; não tentar “limpar” o texto original de modo destrutivo. |

Decisões que precisam ser confirmadas durante a implementação, sem bloquear as fases P0/P1:

- limite final de retenção de runs terminais por tamanho e idade;
- disponibilidade de uma operação remota de reconciliação no Hermes futuro;
- métrica mínima aceitável de fluidez no Raycast Windows;
- texto final da ação que abre configurações de ferramentas.
