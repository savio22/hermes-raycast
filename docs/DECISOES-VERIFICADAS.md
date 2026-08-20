# Decisões verificadas experimentalmente

Este documento **prevalece** sobre `ARCHITECTURE.md` e `UX-SPEC.md` onde houver
divergência. Cada decisão aqui foi provada contra o Hermes real rodando em
`127.0.0.1:8642` (v0.20.4) em 2026-08-19, com a transcrição do experimento.

---

## D-01 — Motor do comando principal: `/v1/runs` amarrado a uma sessão `source:"desktop"`

**Status: RESOLVIDO.** Fecha o bloqueador V-1/P2 da UX-SPEC §0.2.

O dilema era: `/api/sessions/{id}/chat/stream` sincroniza com o Desktop mas o
servidor mata a execução quando a conexão cai — o que viola o princípio 8 do
brief ("fechar a janela do Raycast não deve ser tratado como cancelamento").
Já `/v1/runs` sobrevive à desconexão, mas não estava verificado se grava as
mensagens no `state.db`, ou seja, se o Desktop enxerga.

**A resposta é que dá para ter os dois.** Sequência verificada:

```
POST /api/sessions   {"source":"desktop","title":"<título único>"}
   -> {"session":{"id":"api_1787173253_21269392","source":"desktop","message_count":0,...}}

POST /v1/runs        {"input":"Responda apenas: sincronizado",
                      "session_id":"api_1787173253_21269392"}
   -> {"run_id":"run_e4118ab9ebc24b1ab1878f6cfb8e2866","status":"started"}
```

Estado da sessão depois que a run terminou:

```
id            = 'api_1787173253_21269392'
source        = 'desktop'          <- preservado
message_count = 2                  <- as mensagens foram gravadas
model         = 'gpt-5.6-sol'
```

E as mensagens realmente existem em `GET /api/sessions/{id}/messages`:

```
- user      | 'Responda apenas: sincronizado'
- assistant | 'sincronizado'
```

**Consequência:** o comando `Perguntar ao Hermes` deve, na primeira pergunta de
uma conversa nova, criar a sessão com `source:"desktop"` e então disparar
`/v1/runs` com aquele `session_id`. Perguntas seguintes reutilizam o mesmo
`session_id`.

## D-02 — Runs sobrevivem à desconexão do cliente (princípio 8 do brief)

**Status: PROVADO.**

Experimento: iniciar uma run longa, conectar ao stream de eventos, derrubar a
conexão após 2 s, esperar 12 s sem nenhum cliente conectado, e consultar o
status.

```
POST /v1/runs {"input":"Conte devagar de 1 ate 30, um numero por linha..."}
   -> {"run_id":"run_ee23e54e2e03479a95103345ff3ff139","status":"started"}

[stream conectado e derrubado após 2s]

GET /v1/runs/{id}  logo após desconectar  -> "status": "running"
GET /v1/runs/{id}  12s depois             -> "status": "completed",
     "output": "1\n2\n3\n...\n30", "usage": {...,"total_tokens":20130}
```

**Consequência:** fechar a janela do Raycast não cancela nada. A extensão só
precisa persistir o `run_id` localmente para conseguir reabrir o resultado —
o que é obrigatório de qualquer forma, porque **não existe rota `GET /v1/runs`
para listar execuções**.

## D-03 — Formatos de SSE são DIFERENTES entre os dois streams

**Status: CAPTURADO AO VIVO.** Ver `docs/research/fixtures/CAPTURAS-AO-VIVO.md`
para as transcrições literais.

| | `/v1/chat/completions` | `/v1/runs/{id}/events` |
|---|---|---|
| Fim do stream | `data: [DONE]` | `: stream closed` (comentário SSE) |
| Tipo do evento | campo `object` do JSON | campo `event` do JSON |
| Campo `event:` do SSE | não usado | **não usado** |
| Contagem de tokens | `prompt_tokens` / `completion_tokens` | `input_tokens` / `output_tokens` |

O parser **precisa** tratar linhas iniciadas por `:` — normalmente descartadas
como comentário/keepalive — porque `: stream closed` é o sinal de término do
stream de runs. Esperar `[DONE]` ali deixa a interface pendurada até o timeout.

Eventos observados no stream de runs: `message.delta` (campo `delta`),
`reasoning.available` (campo `text`), `run.completed` (campos `output` e
`usage`).

## D-04 — `jobs_admin` é legenda desatualizada, não estado (REVISADA em 2026-08-19)

**Status: OBSERVAÇÃO MANTIDA, INFERÊNCIA REFUTADA — agora com prova ao vivo.**

A redação anterior desta decisão dizia: *"a capability que as governa está off
[…] o comando de Automações precisa checar `features.jobs_admin` e se ocultar
quando for `false`"*. A **observação** continua verdadeira — o campo vem
`false`. A **inferência** de que ele governa as rotas era um palpite, nunca
testado, e está errada. Ela teria feito a extensão esconder uma tela que
funciona.

### O que foi provado

`grep` recursivo por `jobs_admin` em toda a árvore do Hermes devolve **uma
única linha**: `gateway/platforms/api_server.py:3189`, um literal `False` dentro
do dicionário de `features`. Nenhum handler o lê, nenhuma configuração o
altera.

O portão real é `_CRON_AVAILABLE`. `_check_jobs_available`
(`api_server.py:5692-5698`) olha só essa variável e devolve **501** quando ela é
falsa. Não existe caminho de 403 por capability: o único 403 do servidor vem do
middleware de CORS, que a extensão não aciona por nunca mandar header `Origin`.

Sondagem contra o servidor real, em 2026-08-19:

```
GET /api/cron/fire         -> 405   (a rota existe; só o método está errado)
GET /api/rota-inexistente  -> 404   (controle: rota ausente responde 404)
GET /api/jobs                       -> 200  {"jobs": []}
GET /api/jobs?include_disabled=true -> 200  1 automação real
```

O 405 prova `_CRON_AVAILABLE == True`, porque `POST /api/cron/fire` só é
registrada dentro do bloco `if _CRON_AVAILABLE:` (`api_server.py:2101-2104`).

### Consequências

1. **Construir a tela de Automações**, detectando pela resposta HTTP: `200` com
   lista, `501` com estado vazio explicativo (E19), `401` caindo na tela de
   primeiro uso. **Nunca** com gate em `features.jobs_admin`.
2. **`?include_disabled=true` é obrigatório na chamada.** O default do servidor
   é falso e filtra jobs desabilitados. Sem o parâmetro, esta máquina — que tem
   um job pausado — veria "nenhuma automação" com uma automação real no disco.
3. **Regra geral para o resto do roteiro.** `features.*` tem duas espécies:
   valores **derivados** de estado real (`cors` é `bool(self._cors_origins)`,
   `api_server.py:3196`) e **literais fixos** (`admin_config_rw`, `jobs_admin`,
   `memory_write_api`, `audio_api`, `realtime_voice`, `:3188-3193`). Os
   derivados podem ser lidos como estado; os literais são documentação, e
   precisam ser conferidos contra a tabela de rotas antes de virarem decisão.
   Dos cinco literais falsos, `jobs_admin` é o único cujo valor contradiz a
   tabela de rotas — para os outros quatro não há rota, e "não construir"
   continua certo, agora pelo motivo certo.

**Lição de método:** "a capability diz `false`" e "a funcionalidade não
funciona" são afirmações diferentes. Esta decisão nasceu marcada como
`OBSERVADO`, não `PROVADO`, e a diferença entre os dois carimbos era exatamente
esta.

## D-05 — `/v1/chat/completions` NÃO é o caminho, apesar de funcionar

**Status: CONFIRMADO por D-01.**

O endpoint funciona e faz streaming corretamente (capturado ao vivo), mas cria
sessões com `source:"api_server"`, que o Desktop filtra para fora de Recentes.
Verificado na prática: as duas primeiras chamadas de teste deste projeto
produziram as sessões `Responder apenas ok` e `Dizer apenas pronto`, ambas
`source: "api_server"`.

Como a sincronia com o Desktop é o objetivo declarado do projeto, este endpoint
fica fora da implementação.

## D-06 — Custo base por turno é ~20.000 tokens de entrada

**Status: OBSERVADO** em todas as quatro chamadas de teste
(19.996 a 20.009 tokens de entrada, para prompts de menos de 10 palavras).

O Hermes injeta um system prompt grande. Não é anomalia nem erro da extensão.
A interface não deve sugerir que perguntas curtas são baratas, e vale exibir o
consumo quando disponível.

## D-07 — Ferramenta de teste: `node --test` sem dependências

**Status: VERIFICADO** nesta máquina (Node v24.14.1): `node --test` executa
arquivos `.test.ts` com remoção nativa de tipos, sem transpilador.

Atende à regra do brief de evitar dependências quando a API nativa resolve.
**Restrição:** a remoção nativa de tipos não aceita construções que exigem
transformação — `enum`, `namespace`, decorators, `import =`. Usar objetos
`as const` no lugar de `enum` e `import type` para tipos.

## D-08 — Ler `API_SERVER_KEY` do `.env` é APROVADO (fecha a pendência P1)

**Status: DECIDIDO PELO USUÁRIO** em 2026-08-19. Substitui a pendência P1 da
seção "Decisões pendentes" de `ARCHITECTURE.md`, que fica encerrada.

O plano original continha uma tensão real: proíbe "ler arquivos internos do
Hermes" e ao mesmo tempo proíbe "exigir terminal para o uso normal". A chave
mora em `<HERMES_HOME>\.env`, então cumprir as duas coisas ao pé da letra é
impossível.

**Decisão: manter a ação `Detectar configuração automaticamente` como está**,
com as travas já implementadas:

- roda **somente** por ação explícita do usuário, nunca em background, nunca
  no mount de nenhuma tela;
- lê **apenas** a linha `API_SERVER_KEY=` do `.env` e a porta do `config.yaml`
  — nenhum outro conteúdo desses arquivos, e nunca o `auth.json`;
- **nunca exibe o valor** — nem o valor, nem um prefixo, nem o tamanho, nem
  uma versão mascarada;
- nunca copia a chave para a área de transferência;
- guarda a chave no LocalStorage do Raycast (banco criptografado), e a
  preferência digitada pelo usuário continua tendo precedência.

**Consequência para quem for implementar:** a invariante 3 da `ARCHITECTURE.md`
("`discovery.ts` só pode ler `API_SERVER_PORT`") está relaxada exatamente nestes
termos e não deve ser reinstaurada. Nenhuma outra leitura de arquivo interno do
Hermes fica autorizada por esta decisão.
