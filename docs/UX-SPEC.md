# UX-SPEC — Hermes para Raycast (Windows)

Especificação completa de experiência e interface. Este documento é a fonte da verdade de UI para o
agente de implementação: nomes de comando, telas, estados, textos literais em pt-BR, atalhos e
regras de sincronização com o Hermes Desktop.

- Escopo especificado agora: **MVP completo** (7 comandos). Fases 2 e 3 têm apenas inventário e
  princípios, sem tela a tela.
- Fontes: `INSTRUCOES_DO_PROJETO.md` (produto) e `docs/research/01..07` (fatos técnicos verificados).
  **Onde os dois discordam, a pesquisa vence e o desvio está marcado com `DESVIO`.**
- Todo texto entre aspas ou em bloco `texto` é **literal** e deve ir para o código exatamente assim.

Ordem de leitura recomendada: §0 → §4 (estados) → §10 (glossário) → §1 → §2 → §3 → §5..§9.

---

## 0. Decisões estruturais, desvios e um bloqueador

### 0.1 Desvios em relação ao brief (obrigatório declarar)

| # | O brief diz | A pesquisa mostra | Decisão desta spec |
|---|---|---|---|
| D1 | "não ler diretamente arquivos internos do Hermes" e "nunca exigir terminal" | A chave só existe em `%LOCALAPPDATA%\hermes\.env`, linha com `API_SERVER_KEY=` (01 §2.6-2.7, que **recomenda** esse parsing; 06 R1 sugere apenas instruir o usuário a copiar). | **Leitura explícita, pontual e iniciada pelo usuário** de UMA chave desse arquivo, pela ação `Detectar configuração automaticamente`. Nunca em background, nunca automática, nunca exibida. Regras completas em §3. ⚠️ **Sob decisão humana P1** (`ARCHITECTURE.md` → "Decisões pendentes"), que hoje proíbe essa leitura. **Não implementar a §3.5 antes de P1 ser decidida**; o caminho manual da §3.7 já cobre o MVP sozinho. |
| D2 | `apiServerKey` é preferência protegida | O Raycast **não tem API para escrever preferências** (07 §6.5: só `openExtensionPreferences()` / `openCommandPreferences()`). | A chave detectada é gravada em `LocalStorage` (banco local **criptografado** do Raycast, 07 §11.1). A preferência `password` continua existindo como caminho manual e **tem precedência**. `Cache` NUNCA guarda a chave (é arquivo simples em disco). |
| D3 | `apiServerKey` seria obrigatória | Se `required: true`, o Raycast bloqueia o comando numa tela nativa antes do nosso onboarding. | `"required": false` em todas as preferências. O onboarding é nosso (§3). |
| D4 | Sete rótulos de estado cobrem tudo | Uma run pode sumir do servidor (404 por reinício do gateway ou TTL de 1 h — 04 §7.1). Isso **não é** "Falhou". | Adicionamos **uma** condição de lista, não um estado: `Execução expirada`. Nunca chamar de "Falhou" (seria mentira) nem de "Cancelado". Ver §4.3. |
| D5 | Aprovação deve mostrar "nome da ferramenta e argumentos" | O evento `approval.request` **não tem `tool_name` nem `args`** (04 §4.5). Traz `command`, `description`, `pattern_key(s)`. | A tela de aprovação mostra o **comando literal** e a **descrição do risco**. É proibido inventar/adivinhar nome de ferramenta. Ver §7. |
| D6 | "Menu Bar" e AppleScript | Indisponíveis no Windows (07 §17). | Não usados. `"platforms": ["Windows"]`. |
| D7 | Chat via `/v1/chat/completions` | Não serve para conversas compartilhadas: ids opacos, sem lista (03 §E). | Nunca usado no MVP. |
| D8 | Jobs no roadmap | `features.jobs_admin: false`, mas as 8 rotas existem e respondem 200 ou 501 (02 §7.1). | `Automações` fica na fase 2 e só aparece se `GET /api/jobs` responder 200. |

### 0.2 O motor de execução — decisão e o bloqueador V-1

Dois transportes existem e são incompatíveis em uma propriedade crítica:

| Transporte | Sincroniza com o Desktop | Sobrevive ao fechamento da janela |
|---|---|---|
| `POST /api/sessions/{id}/chat/stream` | **Sim, verificado** (06 §6.2) | **Não** — o servidor interrompe o agente ao cair a conexão (04 §8.2) |
| `POST /v1/runs` + `GET /v1/runs/{id}/events` | Depende de V-1 | **Sim, verificado** (04 §8.1) |

O princípio 8 do brief ("fechar a janela do Raycast não deve ser tratado como cancelamento") é
inegociável, mas a sincronia com o Desktop é a manchete do produto e é a única das duas que está
**verificada**. Por isso a escolha do motor é a **decisão pendente P2** (`ARCHITECTURE.md` →
"Decisões pendentes"), e o default enquanto V-1 não for executado é o **conservador**:

- `Perguntar ao Hermes` e `Conversas` → `POST /api/sessions/{id}/chat/stream` (sincronia verificada);
- `Executar tarefa no Hermes` → `POST /v1/runs` (sobrevivência verificada).

Ou seja: **a variante V-1b de §6.5 é o texto vigente** até V-1 dizer o contrário. Se V-1 der "sim",
`Perguntar ao Hermes` migra para `/v1/runs`, sempre com um `session_id` de uma conversa criada por
nós com `"source": "desktop"`, e o texto principal de §6.5 volta a valer. Telas, estados, textos e
atalhos são idênticos nos dois casos.

> **BLOQUEADOR V-1 — o agente de implementação deve resolver isto ANTES de escrever telas.**
> Verificar, contra o Hermes real: uma `POST /v1/runs` com `session_id` de uma conversa existente
> **grava as mensagens do turno em `state.db` sob essa conversa?**
> Teste: criar conversa → `POST /v1/runs {input, session_id}` → esperar `run.completed` →
> `GET /api/sessions/{id}` e conferir `message_count >= 1` e `GET /api/sessions/{id}/messages`.
> - **V-1 = sim** → motor `/v1/runs` em todos os comandos. Texto de §6.5 vale como está.
> - **V-1 = não** → `Perguntar ao Hermes` e `Conversas` passam para `/api/sessions/{id}/chat/stream`
>   (sincronia é a manchete do produto e é verificada); `Executar tarefa` continua em `/v1/runs`.
>   Nesse caso, e **somente** nesse caso, trocar o texto de §6.5 pela variante V-1b ali indicada.
> As telas, os estados, os textos e os atalhos são **idênticos** nos dois casos. Só o transporte muda.

**Regra de higiene válida nos dois ramos:** ao terminar um turno, se
`GET /api/sessions/{id}` retornar `message_count === 0`, apagar a linha com
`DELETE /api/sessions/{id}`. Conversas vazias são invisíveis no Desktop e viram lixo (06 R4).

### 0.3 Regras de sincronia herdadas da pesquisa (resumo operacional)

- Criar conversa **sempre** com `"source": "desktop"` — sem isso ela cai na seção "Messaging/API" do
  Desktop, fora de Recentes (06 R3).
- Nunca criar conversa vazia; criar no momento do primeiro envio (06 R4).
- Título é **único no banco inteiro**: colisão devolve `400 invalid_title`. Estratégia: título =
  primeiros 60 caracteres da pergunta; em colisão, tentar `" (2)"`, `" (3)"`; na terceira falha,
  criar **sem** título (03 B.3).
- Metadados mudam só por `PATCH /api/sessions/{id}` (campos aceitos: `title`, `end_reason`, `pinned`,
  `archived`, `hidden`, `unread`) — nunca escrever no SQLite (06 R5).
- Host literal `127.0.0.1`. **Nunca** enviar header `Origin` (403 vazio antes da auth) (01 §0, §5.2).
- Validação de porta: `GET /health` e exigir `platform === "hermes-agent"` (8644 é o webhook) (01 §4.6).
- Seguir o `session_id` devolvido pelo servidor para frente: compressão de contexto troca o id (03 C.4 §8).

---

## 1. Inventário de comandos

### 1.1 MVP — especificado neste documento

Ordem do array `commands` do `package.json` = ordem de prioridade na busca do Raycast.
`Perguntar ao Hermes` é o primeiro, conforme o brief.

| # | `name` | `title` | `subtitle` | `mode` | Arquivo |
|---|---|---|---|---|---|
| 1 | `ask-hermes` | `Perguntar ao Hermes` | `Hermes` | `view` | `src/ask-hermes.tsx` |
| 2 | `sessions` | `Conversas do Hermes` | `Hermes` | `view` | `src/sessions.tsx` |
| 3 | `run-task` | `Executar tarefa no Hermes` | `Hermes` | `view` | `src/run-task.tsx` |
| 4 | `active-runs` | `Execuções do Hermes` | `Hermes` | `view` | `src/active-runs.tsx` |
| 5 | `models` | `Modelos do Hermes` | `Hermes` | `view` | `src/models.tsx` |
| 6 | `check-connection` | `Verificar conexão com Hermes` | `Hermes` | `view` | `src/check-connection.tsx` |
| 7 | `configure-hermes` | `Configurar Hermes` | `Hermes` | `view` | `src/configure-hermes.tsx` |

`description` literais (mín. 12 caracteres pelo schema — 07 §5.2):

```
ask-hermes        Faça uma pergunta ao Hermes e receba a resposta na hora, com opção de continuar a conversa.
sessions          Veja, pesquise, continue, renomeie e organize suas conversas do Hermes, incluindo as do Hermes Desktop.
run-task          Peça uma tarefa mais longa ao Hermes e acompanhe cada etapa até o resultado final.
active-runs       Acompanhe as tarefas em andamento, responda pedidos de aprovação e reabra resultados recentes.
models            Veja os modelos disponíveis no seu Hermes e escolha qual usar por padrão.
check-connection  Verifique se o Hermes está ligado e se a conexão da extensão está funcionando.
configure-hermes  Conecte a extensão ao Hermes instalado neste computador, sem precisar de terminal.
```

**Argumentos** (máximo 3 por comando, 07 §7):

```jsonc
// ask-hermes
"arguments": [
  { "name": "pergunta", "type": "text", "placeholder": "O que você quer perguntar?", "required": false }
]
// run-task
"arguments": [
  { "name": "tarefa", "type": "text", "placeholder": "Descreva a tarefa", "required": false }
]
```

Nenhum outro comando tem argumentos. Argumento vazio nunca é erro: leva ao formulário (§2.1.1).

**`keywords`** (ajudam quem não lembra o nome; máx. 12, ≤25 caracteres cada):
`ask-hermes`: `hermes, ia, ai, perguntar, pergunta, chat, agente`.
`sessions`: `hermes, conversas, historico, chats, sessoes`.
`run-task`: `hermes, tarefa, executar, run, agente`.
`active-runs`: `hermes, execucoes, andamento, aprovacao, status`.
`models`: `hermes, modelos, modelo, provider, ia`.
`check-connection`: `hermes, conexao, diagnostico, testar, status`.
`configure-hermes`: `hermes, configurar, conectar, chave, ajustes`.

**`view` vs `no-view` — justificativa de cada escolha:**

- Os sete são `view`. Todos precisam mostrar progresso, resultado ou lista navegável, e
  **`no-view` é incompatível com streaming**: o comando é destruído quando a função retorna
  (07 §12.2, gotcha 4). Um resultado que só aparece em Toast quebraria os princípios 4 e 5 do brief.
- `check-connection` poderia ser `no-view` com Toast, mas precisa oferecer três ações
  (`Tentar novamente`, `Abrir configurações`, `Copiar detalhes técnicos`) e um diagnóstico legível —
  Toast só comporta duas ações e nenhum texto longo (07 §9.5). Logo, `view`.
- `configure-hermes` é `view` porque é uma tela de onboarding com escolha entre caminho automático e
  manual.
- **Nenhum comando usa `mode: "menu-bar"`** (indisponível no Windows, 07 §17).
- `interval` (background refresh) **não é usado no MVP**: exigiria `no-view` e o mínimo seguro é 1
  minuto, cadência inútil para acompanhar uma execução.

### 1.2 Fase 2 — inventário, sem tela a tela

| `name` | `title` | `mode` | Justificativa do modo |
|---|---|---|---|
| `ask-selection` | `Perguntar sobre seleção` | `view` | Usa `getSelectedText()` (suportado no Windows, 07 §10.2) com fallback para clipboard; precisa exibir a resposta em streaming. |
| `summarize-clipboard` | `Resumir clipboard` | `view` | idem. |
| `fix-clipboard` | `Corrigir texto do clipboard` | `view` | idem. |
| `translate-clipboard` | `Traduzir clipboard` | `view` | idem. |
| `paste-answer` | `Colar última resposta` | `no-view` | Efeito colateral puro: lê o LocalStorage, `Clipboard.paste`, `showHUD`. Nada a exibir. |
| `skills` | `Skills do Hermes` | `view` | Lista pesquisável (`GET /v1/skills`, só nome/descrição/categoria — 02 §4.2). Somente leitura. |
| `toolsets` | `Ferramentas do Hermes` | `view` | Lista com badges `Ativa` / `Precisa de configuração` (02 §5.3). Somente leitura: não existe rota para ligar/desligar. Chamada lenta → cache de 5 min (02 §5.7). |
| `jobs` | `Automações do Hermes` | `view` | Só aparece se `GET /api/jobs` responder 200; em 501 mostra estado vazio explicativo. |

### 1.3 Fase 3 — não especificado

Anexos e imagens; deeplinks `raycast://` para comandos da extensão; Tool para a IA do Raycast;
Hermes remoto; macOS.

### 1.4 Preferências da extensão (nível extensão, herdadas por todos os comandos)

> O JSON normativo está em `ARCHITECTURE.md` §5.1 e **vence** em caso de divergência. Esta tabela é
> só a camada de texto visível. Todas com `"required": false` (D3), inclusive `apiServerKey`.

| `name` | `type` | `title` | `label` (checkbox) | `default` | `description` |
|---|---|---|---|---|---|
| `apiServerKey` | `password` | `Chave de acesso do Hermes` | — | — | `Chave local do Hermes API Server. Use "Detectar configuração automaticamente" no comando Configurar Hermes se você não sabe qual é.` |
| `apiUrl` | `textfield` | `Endereço do Hermes` | — | **nenhum** (vazio = detecção automática) | `Deixe em branco para detectar automaticamente. Preencha apenas se o seu Hermes usa outra porta.` |
| `streamResponses` | `checkbox` | `Resposta` | `Mostrar a resposta enquanto ela é escrita` | `true` | `Desative se você preferir ver apenas a resposta pronta.` |
| `defaultModel` | `textfield` | `Modelo padrão` | — | — | `Opcional. Deixe em branco para usar o modelo padrão configurado no Hermes.` |
| `defaultProvider` | `textfield` | `Provedor padrão` | — | — | `Opcional. Só preencha se o suporte pediu ou se você sabe exatamente o que faz.` |
| `sessionKey` | `textfield` | `Escopo de memória` | — | `raycast:windows:default` | `Avançado. Identifica a memória de longo prazo usada por esta extensão. Mude somente se souber o efeito.` |
| `maxHistoryItems` | `dropdown` (`25/50/100/200`) | `Itens por página` | — | `50` | `Quantas conversas carregar de uma vez nas listas.` |

**`apiUrl` não tem default** (ARCHITECTURE D1): um valor preenchido desliga a auto-descoberta de
porta — a preferência sempre vence e nunca cai para descoberta. Com default fixo, uma instalação em
outra porta ficaria permanentemente quebrada.

**`maxHistoryItems` é `dropdown`, não `textfield`** (ARCHITECTURE D5): o schema do manifest tem sete
tipos e **nenhum numérico** (07 §6.1); um textfield exigiria validação e falharia para o público
não técnico. `limit` do servidor é limitado a 200 em `/api/sessions` (03 B.1).

**Não existe preferência `desktopSync`.** `source` é sempre `"desktop"`, constante no código
(06 R3, ARCHITECTURE D7). Um interruptor aqui seria enganoso em dois níveis: (a) desligá-lo não
deixa a conversa "só no Raycast" — ela continua gravada no mesmo `state.db` do Desktop, só muda de
seção para "Messaging/API"; (b) a sincronia é a manchete do produto e não é uma opção avançada.

---

## 2. Especificação tela a tela

Convenções desta seção:

- **Estado de carregamento** = `isLoading` + placeholders nativos do Raycast. Nunca uma tela em branco.
- **Toda tela** tem `ActionPanel`, mesmo vazia ou em erro. Nenhuma ação fica órfã: tudo está no painel
  (`Ctrl+K`), e os atalhos são apenas aceleradores (§9).
- **Guarda de configuração:** todo comando, antes de qualquer requisição, resolve a chave (§3.3). Sem
  chave → renderiza a tela `SemConfiguracao` (§3.4) no lugar do conteúdo. Sem exceção.
- `navigationTitle` de cada tela está indicado; ele é o título que aparece no topo do Raycast.

### 2.1 `Perguntar ao Hermes` (`ask-hermes`)

#### 2.1.1 Entrada — `Form` (quando o argumento `pergunta` vem vazio)

`navigationTitle`: `Perguntar ao Hermes`

Componentes, nesta ordem:

1. `Form.TextArea` `id="pergunta"` — `title="Sua pergunta"`,
   `placeholder="Escreva sua pergunta. Ex.: resuma este relatório em 5 tópicos."`, `autoFocus`.
   `enableDrafts` **somente** quando este `Form` é a raiz do comando `ask-hermes`; quando ele é
   empilhado por `Action.Push` (vindo de §2.2 ou §2.5), `enableDrafts` fica `false` — rascunho de
   view empilhada não é suportado e o `draftValues` chegaria pelo `LaunchProps` do comando errado.
2. `Form.Dropdown` `id="conversa"` — `title="Conversa"`. Itens:
   `Nova conversa` (valor `new`, primeiro e padrão) seguido das 5 conversas mais recentes,
   cada uma com o título ou `Sem título` e a data relativa.
3. `Form.Dropdown` `id="modelo"` — `title="Modelo"`. Primeiro item: `Padrão do Hermes` (valor vazio).
   Demais itens vêm de `GET /api/model/options`, carregados **em segundo plano**; enquanto não
   chegam, o dropdown tem só o item padrão e não bloqueia o envio (princípio 10 do brief).

Banner condicional, como primeiro filho do `Form`, quando houver execução não terminal registrada:

```
Form.Description
title: "Em andamento"
text:  "Você tem 1 tarefa em andamento no Hermes."      // ou "N tarefas em andamento no Hermes."
```

`ActionPanel`:

| Ordem | Título (literal) | Atalho | Comportamento |
|---|---|---|---|
| 1 | `Perguntar ao Hermes` | `Enter` | `Action.SubmitForm`. Valida pergunta não vazia; erro de campo: `Escreva sua pergunta.` |
| 2 | `Ver tarefas em andamento` | `Ctrl+Shift+E` | `Action.Push` para `Execuções do Hermes`. Só existe quando o banner existe. |
| 3 | `Abrir configurações` | `Ctrl+Shift+A` | `openExtensionPreferences()` |

Validação: `useForm` com `FormValidation.Required` no campo `pergunta`.

#### 2.1.2 Envio — sequência

1. Toast `Toast.Style.Animated` — título `Enviando ao Hermes…`.
2. Se `conversa === "new"`: `POST /api/sessions` com `{ id, title, source: "desktop" }` —
   `source` é **constante** (06 R3; não existe preferência para isso).
   `id` = `newSessionId()` de `ARCHITECTURE.md` §7.5, ou seja `raycast_<epoch_ms>_<8 hex>`.
   Tratamento de `400 invalid_title` conforme §0.3; `409 session_exists` ⇒ gerar outro id uma vez.
3. Gravar em `LocalStorage`, **antes de renderizar**, o registro da execução (04 §7.1) com
   `rememberRun()` — a forma é `StoredRun` de `ARCHITECTURE.md` §9.2:
   `{ runId, sessionId, promptPreview, createdAt, lastKnownStatus, lastKnownEvent?, baseUrl }`.
   Não inventar campos: tudo que a lista de §2.5 mostra sai daí.
4. Envio — **depende de P2** (§0.2). Default vigente (conservador): `POST /api/sessions/{id}/chat/stream`
   com `{ message }` e o header `X-Hermes-Session-Key`, consumido por `consumeSessionChatStream()`;
   os passos 3 e 5 valem só para o ramo `/v1/runs`. Ramo `/v1/runs` (se V-1 confirmar):
   `POST /v1/runs { input, session_id, model?, provider? }` → 202 `{ run_id, status: "started" }`;
   o literal `"started"` **não** entra no enum de estados (04 §1.6).
   Nos dois ramos, `model`/`provider` saem de `resolveModelChoice()` (P3), não da preferência crua.
5. `push` da tela de resposta (§2.1.3) e abertura imediata do stream
   `GET /v1/runs/{run_id}/events` — imediata porque a fila de eventos do servidor é descartada em
   300 s sem assinante (04 §7.2).
6. Toast some assim que o primeiro token chega.

#### 2.1.3 Resposta — `Detail` (a tela central do produto)

Detalhes completos de streaming, ações e fechamento de janela em **§6**. Resumo estrutural:

- `Detail` com `markdown`, `metadata` e `isLoading` enquanto o estado não for terminal.
- `navigationTitle`: título da conversa, ou os primeiros 40 caracteres da pergunta.
- Dois modos alternáveis por `Ctrl+T`: **Resposta** (padrão) e **Etapas**.
- `Detail.Metadata` (barra lateral), sempre visível:

```
Estado           <rótulo dos 7, com ícone e cor de §4>
Conversa         <título ou "Sem título">
Modelo           <model do status, ou "Padrão do Hermes">
Sincronização    "Aparece no Hermes Desktop"    (valor único; não há caminho que produza outro)
Duração          "12 s"                         (só após o término)
```

- `Detail.Metadata.TagList` "Etapas" aparece somente no modo Etapas.

#### 2.1.4 Estados desta tela

| Estado | O que o usuário vê |
|---|---|
| Carregando (antes do 1º token) | `isLoading` ativo; markdown = cabeçalho com a pergunta + linha `_Preparando…_`; metadata com Estado = **Preparando**. |
| Streaming | Texto crescendo; Estado = **Executando**; ação `Parar` disponível. |
| Aguardando aprovação | Bloco de aprovação embutido no topo do markdown + `Action.Push` para a tela de aprovação (§7). Estado = **Aguardando aprovação**. |
| Sucesso | Resposta completa; Estado = **Concluído**; ações finais (§6.4). |
| Vazio (resposta sem texto) | Markdown: `O Hermes terminou sem escrever uma resposta.` + ações `Tentar novamente`, `Ver etapas`. |
| Erro | Substitui o corpo pelo bloco de erro de §5, preservando o texto já recebido acima dele. |
| Cancelado | Texto parcial preservado; Estado = **Cancelado**; ações `Copiar o que veio`, `Perguntar de novo`, `Continuar esta conversa`. |

### 2.2 `Conversas do Hermes` (`sessions`)

`navigationTitle`: `Conversas do Hermes`. Componente: `List` com `isShowingDetail={false}`,
`searchBarPlaceholder="Pesquisar conversas por título"`, `filtering` client-side (a API **não tem**
parâmetro de busca — 03 B.1).

Dados: `GET /api/sessions?limit=<maxHistoryItems>&offset=0`. Paginação via `pagination` do `List`
(`pageSize`, `hasMore` vindo do campo `has_more`, `onLoadMore`).
**Atenção:** `has_more` só conta linhas não fixadas e as fixadas são inseridas **além** do `limit`
(03 B.1) — o próximo `offset` é `nextSessionOffset(offsetAtual, página)` de `ARCHITECTURE.md` §7.5
(soma só as linhas **não** fixadas retornadas), nunca `offset + limit`.

**Seções:**
1. `Fixadas` — itens com `pinned === true`.
2. `Recentes` — o restante, ordenado por `last_active` (a API já ordena).

**Item da lista:**

- `title`: `session.title` ou `Sem título`
- `subtitle`: `session.preview` (primeiros ~60 caracteres da primeira mensagem do usuário)
- `icon`: por origem — criada no Raycast (o id começa com `raycast_`, prefixo de `newSessionId()`;
  não é preciso guardar lista nenhuma) → `Icon.Bolt`; `desktop`/`cli`/`dashboard` → `Icon.Desktop`;
  `telegram`/`discord`/`slack` → `Icon.Message`; demais → `Icon.Circle`
- `accessories`:
  - `{ tag: "Criada no Raycast" }` quando o id começa com `raycast_`, senão `{ tag: "Do Hermes Desktop" }`
    para `source` em `desktop|cli|dashboard|hermes_browser`
  - `{ text: "<n> mensagens" }`
  - `{ date: new Date(last_active * 1000) }`  ← `last_active` vem em **segundos**, não milissegundos

**`ActionPanel` do item:**

| Ordem | Título (literal) | Atalho | Detalhe |
|---|---|---|---|
| 1 | `Abrir conversa` | `Enter` | `Action.Push` → §2.3 |
| 2 | `Continuar esta conversa` | `Ctrl+Shift+Return` | `Action.Push` → formulário de §2.1.1 com a conversa já escolhida |
| 3 | `Abrir no Hermes Desktop` | `Ctrl+O` | `Action.Open` com `target = hermesDesktopSessionUrl(id)` (`ARCHITECTURE.md` §6.3 — valida o id e faz o `encodeURIComponent`); some quando a função devolver `undefined`. Ver §8.4 |
| 4 | `Copiar resposta mais recente` | `Ctrl+Shift+C` | Busca sob demanda `GET /api/sessions/{id}/messages?limit=1&order=latest` |
| 5 | `Renomear conversa` | `Ctrl+E` | `Action.Push` de um `Form` de um campo; `PATCH {title}` |
| 6 | `Fixar conversa` / `Desafixar conversa` | `Ctrl+.` | `PATCH {pinned}` |
| 7 | `Arquivar conversa` | `Alt+A` | `PATCH {archived: true}`; some da lista |
| 8 | `Ramificar conversa` | `Ctrl+Shift+B` | `POST /api/sessions/{id}/fork`. Copy do sucesso em §10.4 |
| 9 | `Excluir conversa` | `Ctrl+D` | `style: destructive` + `confirmAlert` obrigatório (§2.2.1) |
| 10 | `Nova conversa` | `Ctrl+N` | `Action.Push` → formulário de §2.1.1 com `Nova conversa` pré-selecionada. **Não** chama `POST /api/sessions` aqui: a conversa só nasce junto do primeiro envio (06 R4). É o "criar sessão" exigido pelo MVP #3 do brief. |
| 11 | `Atualizar lista` | `Ctrl+R` | revalidate manual |
| 12 | `Abrir configurações` | `Ctrl+Shift+A` | — |

#### 2.2.1 Confirmação de exclusão (literal)

```
title:   "Excluir esta conversa?"
message: "A conversa \"<título>\" será removida do Hermes, inclusive do Hermes Desktop. Não dá para desfazer."
primaryAction:  { title: "Excluir", style: Alert.ActionStyle.Destructive }
dismissAction:  { title: "Cancelar", style: Alert.ActionStyle.Cancel }
rememberUserChoice: false
```

`rememberUserChoice` **sempre** `false` para exclusão: uma escolha lembrada transformaria um comando
destrutivo em silencioso.

#### 2.2.2 Estados

| Estado | Tela |
|---|---|
| Carregando | `List isLoading` com os placeholders nativos. |
| Vazio (nenhuma conversa) | `List.EmptyView` — `icon: Icon.SpeechBubble`, `title: "Nenhuma conversa por aqui"`, `description: "Quando você perguntar algo ao Hermes, a conversa aparece nesta lista e também no Hermes Desktop."`, com a ação `Perguntar ao Hermes` (`Enter`). |
| Vazio por busca | `List.EmptyView` — `title: "Nada encontrado"`, `description: "Nenhuma conversa com esse texto no título."` |
| Erro | `List.EmptyView` com o texto de erro de §5 e as três ações padrão. |

### 2.3 Detalhe da conversa (tela empilhada, `session-detail.tsx`)

Não é comando; é `push` a partir de §2.2.

`List` com `isShowingDetail`, uma seção por dia (`Hoje`, `Ontem`, `12 de agosto`), item por mensagem.

- `GET /api/sessions/{id}/messages?limit=120&order=latest` (mais recentes primeiro na busca, exibidas
  em ordem cronológica). Página anterior: `offset += 120` mantendo `order=latest` (03 B.7).
- Item: `title` = `Você` ou `Hermes` ou `Ferramenta: <tool_name>`; `subtitle` = primeira linha do
  conteúdo; `detail.markdown` = conteúdo completo.
- **Mensagens de ferramenta ficam ocultas por padrão.** `List.Dropdown` na barra de busca:
  `Somente conversa` (padrão) / `Conversa e ferramentas`.
- Aviso de transcrição truncada: se a API retornar menos do que o `message_count` da conversa,
  exibir como último item da lista:
  `title: "Parte antiga desta conversa não está disponível aqui"`,
  `subtitle: "Abra no Hermes Desktop para ver o histórico completo."` (03 B.7, `include_compacted`).

`ActionPanel`: `Continuar esta conversa` (`Enter`), `Copiar mensagem` (`Ctrl+Shift+C`),
`Copiar conversa inteira` (`Ctrl+Alt+C`), `Abrir no Hermes Desktop` (`Ctrl+O`),
`Renomear conversa` (`Ctrl+E`), `Atualizar` (`Ctrl+R`).

### 2.4 `Executar tarefa no Hermes` (`run-task`)

Mesma máquina de execução de §2.1; a diferença é a **entrada mais rica** e a **saída em etapas**.

#### 2.4.1 `Form` de entrada

1. `Form.TextArea` `id="tarefa"` — `title="O que o Hermes deve fazer"`,
   `placeholder="Descreva a tarefa com o máximo de detalhe possível."`, `autoFocus`.
2. `Form.Separator`
3. `Form.TextArea` `id="instrucoes"` — `title="Instruções extras"`, `info="Opcional. Regras que valem só para esta tarefa, como tom, formato ou limites."` → vai em `instructions` do `POST /v1/runs` (04 §1.1).
4. `Form.Dropdown` `id="modelo"` — `title="Modelo"`, primeiro item `Padrão do Hermes`.
5. `Form.Dropdown` `id="conversa"` — `title="Conversa"`, primeiro item `Nova conversa`.

`Form.Description` fixo no rodapé:

```
title: "Sobre esta tarefa"
text:  "A tarefa continua rodando no Hermes mesmo se você fechar o Raycast. Você pode acompanhar depois em Execuções do Hermes."
```

`ActionPanel`: `Executar tarefa` (`Enter`), `Ver tarefas em andamento` (`Ctrl+Shift+E`),
`Abrir configurações` (`Ctrl+Shift+A`).

Proteção contra duplicidade: não existe `Idempotency-Key` em `/v1/runs` (04 §1.3). O botão de envio
fica desabilitado do clique até chegar o 202.

#### 2.4.2 Saída

Mesma `Detail` de §2.1.3, mas abrindo no modo **Etapas**, não no modo Resposta. `Ctrl+T` alterna.

### 2.5 `Execuções do Hermes` (`active-runs`)

Não existe rota de listagem de runs no servidor (04 §7). **A lista é 100% local**, reconstruída dos
ids gravados em `LocalStorage` e revalidada com `GET /v1/runs/{run_id}` um a um.

`List` com `searchBarPlaceholder="Pesquisar por texto da tarefa"`.

**Seções, nesta ordem:**
1. `Precisa de você` — runs em `waiting_for_approval`
2. `Em andamento` — `queued`, `running`, `stopping`
3. `Concluídas` — `completed`
4. `Encerradas` — `cancelled`, `failed`, expiradas

**Item:** `title` = primeiros 60 caracteres do prompt; `subtitle` = título da conversa;
`icon` = ícone/cor do estado (§4.2); `accessories` = `{ tag: <rótulo do estado> }` e
`{ date: <created_at> }`.

**Polling:** a cada **2 s** enquanto existir pelo menos uma run não terminal e a lista estiver em
primeiro plano; para completamente quando todas forem terminais (04 §3.3). Cada ciclo faz no máximo
10 requisições; runs terminais não são mais consultadas.

**Reconciliação de `404 run_not_found`** (04 §7.1): marcar como `Execução expirada` — **nunca** como
`Falhou`. Ver §4.3.

`ActionPanel` do item:

| Título | Atalho | Quando aparece |
|---|---|---|
| `Ver execução` | `Enter` | sempre |
| `Responder pedido de aprovação` | `Enter` (substitui a 1ª ação) | estado `Aguardando aprovação` |
| `Parar execução` | `Ctrl+Shift+P` | estados não terminais |
| `Orientar execução` | `Ctrl+Shift+G` | **somente** `Executando` (04 §5.3 recusa fora disso) |
| `Copiar resultado` | `Ctrl+Shift+C` | `Concluído` |
| `Abrir no Hermes Desktop` | `Ctrl+O` | quando há `session_id` de conversa real |
| `Perguntar de novo` | `Ctrl+N` | sempre |
| `Remover da lista` | `Ctrl+D` | terminais e expiradas; só apaga o registro local |
| `Atualizar` | `Ctrl+R` | sempre |

`Remover da lista` usa `confirmAlert`? **Não** — não é destrutivo no servidor. Mas o texto precisa
deixar isso claro: usar o título literal `Remover da lista (não apaga nada no Hermes)`.

**Vazio:** `List.EmptyView` — `title: "Nenhuma execução recente"`,
`description: "Quando você pedir uma tarefa ao Hermes, ela aparece aqui até você limpar."`,
ação `Executar tarefa no Hermes`.

### 2.6 `Modelos do Hermes` (`models`)

`GET /api/model/options` → `{ providers[], model, provider }` (02 §3.3). Cache de 10 minutos.

`List` com `isShowingDetail`, uma `List.Section` por provedor (`row.name`), itens = modelos.

- Item `title` = id do modelo; `accessories`:
  - `{ tag: { value: "Em uso", color: Color.Green } }` quando é o modelo/provedor atual
  - `{ tag: "Rápido" }` quando `capabilities[model].fast`
  - `{ tag: "Raciocínio" }` quando `capabilities[model].reasoning`
  - preço, quando existir: `{ text: "entrada $3.00 · saída $15.00" }` (são **strings prontas**, não
    números — 02 §3.4)
- Provedor não autenticado (`authenticated === false`): a seção ganha o accessory
  `{ tag: { value: "Precisa de configuração", color: Color.Orange } }` e os itens ficam com
  `icon: Icon.Lock`. Detalhe traz o `warning` do servidor.

`Detail` do item (`List.Item.Detail.Metadata`): `Provedor`, `Modelo`, `Rápido` (`Sim`/`Não`),
`Raciocínio` (`Sim`/`Não`), `Preço de entrada`, `Preço de saída`, `Origem` (`source`).

`ActionPanel`:

| Título | Atalho | Efeito |
|---|---|---|
| `Usar como modelo padrão` | `Enter` | Grava `{provider, model}` em `LocalStorage` sob `StorageKeys.defaultModel`. **Não** altera o Hermes: não existe rota para isso no API Server (02 §6.6). Precedência sobre a preferência `defaultModel` — decisão **P3**. Toast: `Modelo padrão da extensão atualizado.` |
| `Usar só na próxima pergunta` | `Ctrl+Shift+M` | Grava `StorageKeys.nextTurnModel`, consumido **e apagado** no envio seguinte. É o "override por tarefa sem alterar o default global" do MVP #5. |
| `Copiar nome do modelo` | `Ctrl+Shift+C` | — |
| `Atualizar lista` | `Ctrl+R` | Refaz com `?refresh=true`; Toast animado `Consultando provedores…` porque a chamada é lenta (re-sonda **todos** os provedores). |

**Texto obrigatório de esclarecimento**, como `List.Section` title da primeira seção ou na descrição
do vazio: `O padrão escolhido aqui vale só para a extensão do Raycast. O Hermes Desktop continua com o modelo dele.`
Sem isso o usuário acredita ter mudado o Hermes inteiro — é a confusão mais provável desta tela.

**Vazio:** `title: "Nenhum modelo disponível"`,
`description: "O Hermes está ligado, mas nenhum provedor de modelo está configurado. Abra o Hermes Desktop para configurar um."`

### 2.7 `Verificar conexão com Hermes` (`check-connection`)

`Detail` de diagnóstico, executado assim que o comando abre.

**Sequência (cada passo vira uma linha com ícone):**
1. `Encontrando o Hermes` — `resolveBaseUrl({force: true})` (`ARCHITECTURE.md` §6.1): preferência →
   cache → `config.yaml` → `API_SERVER_PORT` do ambiente → `.env` → `8642`.
2. `Verificando se o Hermes está ligado` — `GET /health`, exigindo `platform === "hermes-agent"`.
3. `Testando sua chave de acesso` — `GET /v1/models` com Bearer.
4. `Conferindo os recursos disponíveis` — `GET /v1/capabilities`.
5. `Procurando suas conversas` — `GET /api/sessions?limit=1`.

**Markdown de sucesso (literal):**

```markdown
# Tudo certo

O Raycast está conectado ao Hermes deste computador.

- ✅ Hermes encontrado em 127.0.0.1:8642
- ✅ Hermes está ligado (versão 0.20.4)
- ✅ Sua chave de acesso funciona
- ✅ Recursos disponíveis: conversas, tarefas, aprovações, streaming
- ✅ 12 conversas encontradas

Suas conversas do Raycast também aparecem no Hermes Desktop.
```

Cada linha usa ✅ para sucesso, ⚠️ para funcionando com ressalva e ❌ para falha. Passos ainda não
executados aparecem com `…` e a tela fica `isLoading` até o último.

**Markdown de falha (exemplo, o texto do erro vem de §5):**

```markdown
# Não foi possível conectar

Não foi possível conectar ao Hermes. Verifique se o Hermes API Server está ativo e se a URL e a chave estão corretas.

- ✅ Hermes encontrado em 127.0.0.1:8642
- ❌ Sua chave de acesso não foi aceita
```

`Detail.Metadata`: `Endereço`, `Versão do Hermes`, `Estado`, `Conversas encontradas`.
**A chave nunca aparece na metadata, nem mascarada.**

`ActionPanel`: `Testar de novo` (`Ctrl+Shift+T`), `Detectar configuração automaticamente`
(`Ctrl+Shift+D`), `Abrir configurações` (`Ctrl+Shift+A`),
`Mostrar detalhes técnicos` (`Ctrl+Shift+I`), `Copiar detalhes técnicos` (`Ctrl+Alt+C`).

### 2.8 `Configurar Hermes` (`configure-hermes`)

Ver §3 inteira — é a tela de primeiro uso e também o ponto de reparo quando algo quebra.

---

## 3. Primeiro uso e a chave de acesso

### 3.1 O problema e a decisão

O brief exige duas coisas que colidem: *nunca exigir terminal* e *não ler arquivos internos do
Hermes*. A chave `API_SERVER_KEY` existe **apenas** em `%LOCALAPPDATA%\hermes\.env` (01 §2.7). Sem
lê-la, o único caminho é o usuário abrir o arquivo por conta própria.

**Decisão (D1):** existe uma ação **explícita, visível e iniciada pelo usuário** chamada
`Detectar configuração automaticamente`. Ela é a única coisa na extensão inteira autorizada a tocar
em arquivos do Hermes, e apenas dentro destes limites:

| Permitido | Proibido |
|---|---|
| Ler `<HERMES_HOME>\.env` procurando **somente** a linha `^\s*(export\s+)?API_SERVER_KEY\s*=` | Ler qualquer outra chave do `.env` |
| Ler `<HERMES_HOME>\config.yaml` para descobrir `platforms.api_server.extra.port` e `.host` | Ler `auth.json`, `state.db`, `desktop.json`, `connections.json` ou qualquer outro arquivo |
| Ler `<HERMES_HOME>\gateway.pid` para saber se o gateway está vivo | Escrever qualquer arquivo do Hermes |
| Rodar isso **só** quando o usuário aciona a ação | Rodar isso na inicialização, em background, em `interval` ou "por conveniência" |
| Guardar o valor em `LocalStorage` (banco criptografado do Raycast) | Guardar em `Cache`, em arquivo, em log, em Toast, em erro ou no clipboard |
| Dizer "encontrei" | Exibir a chave, exibir prefixo/sufixo, exibir o tamanho |

`<HERMES_HOME>` = `process.env.HERMES_HOME` || `path.join(process.env.LOCALAPPDATA, "hermes")` (01 §2.6).
Parser da linha: `partition("=")`, remover `export ` inicial, aspas simples/duplas e `\r` final;
arquivo lido com `utf-8-sig` (01 §2.7).

### 3.2 Nunca em silêncio

Leitura silenciosa de arquivo do usuário é proibida, mesmo que "funcione melhor". A ação sempre:
1. é disparada por tecla ou clique do usuário;
2. mostra um Toast animado `Procurando a configuração do Hermes…`;
3. termina em uma tela que diz **o que foi lido e de onde**;
4. pode ser desfeita por `Esquecer a chave detectada`.

### 3.3 Ordem de resolução da chave (usada por todos os comandos)

```
1. preferência apiServerKey (se preenchida)          → usa
2. LocalStorage "hermes.detectedKey" (se existir)    → usa
3. nada                                              → renderiza SemConfiguracao (§3.4)
```

A preferência sempre vence: se o usuário digitou algo, é a intenção mais recente e explícita.

Se a chave resolvida devolver `401 gateway_auth_failed`: apagar automaticamente **só** a chave vinda
do LocalStorage (nunca a preferência), e cair na tela de erro E2 de §5.

### 3.4 Tela `SemConfiguracao` — o primeiro uso

Renderizada por **qualquer** comando quando não há chave. `Detail`, `navigationTitle` = título do
comando que o usuário abriu.

**Markdown literal:**

```markdown
# Conecte o Raycast ao seu Hermes

Para usar esta extensão, o Raycast precisa de uma chave de acesso do Hermes que está instalado neste computador. Isso é feito uma única vez.

**O jeito mais fácil:** pressione Enter em "Detectar configuração automaticamente". O Raycast procura a chave no seu Hermes, testa a conexão e guarda a chave em segurança. A chave não é exibida em nenhum momento.

Se preferir fazer manualmente, escolha "Configurar manualmente" no painel de ações.
```

`ActionPanel`:

| Ordem | Título | Atalho | Efeito |
|---|---|---|---|
| 1 | `Detectar configuração automaticamente` | `Enter` e `Ctrl+Shift+D` | §3.5 |
| 2 | `Configurar manualmente` | — (só pelo `Ctrl+K`) | `Action.Push` → §3.7. **Sem atalho:** `Ctrl+Shift+A` significa `Abrir configurações` em toda a extensão (§9.2) e um mesmo atalho não pode ter dois significados. |
| 3 | `O que é isso?` | `Ctrl+Shift+I` | `Action.Push` de um `Detail` com o texto de §3.9 |

### 3.5 Caminho automático — telas e textos

**Durante:** Toast `Toast.Style.Animated`, título `Procurando a configuração do Hermes…`.

**Sucesso — `Detail` (literal):**

```markdown
# Pronto, está conectado

Encontrei o Hermes deste computador e a conexão funcionou.

- Endereço: 127.0.0.1:8642
- Versão do Hermes: 0.20.4
- Chave de acesso: encontrada e guardada em segurança

A chave ficou guardada no armazenamento protegido do Raycast e não é exibida em nenhuma tela.

Suas conversas do Raycast vão aparecer também no Hermes Desktop.
```

Ações: `Continuar` (`Enter`, volta ao comando original e o executa),
`Testar de novo` (`Ctrl+Shift+T`), `Esquecer a chave detectada` (`Ctrl+D`, com `confirmAlert`).

**Falha A — arquivo não encontrado:**

```markdown
# Não encontrei o Hermes neste computador

Procurei em:

C:\Users\SAM\AppData\Local\hermes

e não achei o arquivo de configuração do Hermes.

Isso costuma acontecer quando o Hermes está instalado em outra pasta ou ainda não foi instalado.
```

Ações: `Configurar manualmente` (`Enter`), `Tentar de novo` (`Ctrl+R`),
`Abrir a pasta do Hermes` (`Ctrl+Shift+F`, só quando a pasta existir),
`Copiar detalhes técnicos` (`Ctrl+Alt+C`).

**Falha B — arquivo existe, chave ausente:**

```markdown
# Achei o Hermes, mas não achei a chave

O arquivo de configuração existe, mas não tem a linha da chave de acesso.

Arquivo: C:\Users\SAM\AppData\Local\hermes\.env
Linha procurada: uma linha que começa com API_SERVER_KEY=

Abra o Hermes Desktop uma vez e deixe o Hermes ligar. Ele cria essa chave sozinho na primeira execução.
```

Ações: `Tentar de novo` (`Ctrl+R`), `Configurar manualmente` (sem atalho dedicado),
`Abrir a pasta do Hermes` (`Ctrl+Shift+F`), `Copiar o caminho do arquivo` (`Alt+Shift+C`).

**Falha C — chave encontrada mas recusada (401):**

```markdown
# A chave encontrada não foi aceita

Encontrei uma chave no seu Hermes, mas o Hermes recusou essa chave.

Normalmente isso significa que o Hermes está rodando com uma configuração diferente da que está salva em disco. Feche e abra o Hermes Desktop e tente de novo.
```

Ações: `Tentar de novo` (`Ctrl+R`), `Configurar manualmente` (sem atalho dedicado),
`Copiar detalhes técnicos` (`Ctrl+Alt+C`).

**Falha D — Hermes desligado (`ECONNREFUSED`):** usar o texto de erro E1 de §5, com as ações
`Tentar de novo`, `Configurar manualmente`, `Copiar detalhes técnicos`.

### 3.6 O que a detecção nunca faz

- Não escreve na preferência (impossível pela API, D2) e não finge que escreveu.
- Não mostra a chave, nem `sk-…abcd`, nem "36 caracteres".
- Não sai copiando a chave para o clipboard "para o usuário colar" — isso vazaria o segredo para
  qualquer app que leia o clipboard.
- Não roda de novo sozinha se falhar. Falhou, esperou o usuário.

### 3.7 Caminho manual — sem terminal, passo a passo

`Detail` (`navigationTitle`: `Configurar manualmente`). **Literal:**

```markdown
# Configurar manualmente

Você vai copiar uma linha de um arquivo de texto. Não precisa de terminal.

**1. Abra a pasta do Hermes**

Use a ação "Abrir a pasta do Hermes" aqui embaixo. O Explorador de Arquivos abre em:

C:\Users\SAM\AppData\Local\hermes

**2. Abra o arquivo chamado `.env`**

Clique com o botão direito no arquivo `.env` e escolha "Abrir com" → "Bloco de Notas".
Se o arquivo não aparecer, no Explorador vá em "Exibir" e marque "Itens ocultos".

**3. Procure a linha que começa com `API_SERVER_KEY=`**

No Bloco de Notas, pressione Ctrl+F, digite `API_SERVER_KEY` e pressione Enter.
A linha se parece com isto:

API_SERVER_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

**4. Copie só o que vem depois do sinal de igual**

Selecione o texto depois do `=`, copie com Ctrl+C e feche o Bloco de Notas sem salvar.

**5. Cole nas configurações da extensão**

Use a ação "Abrir configurações" e cole no campo "Chave de acesso do Hermes".

Guarde essa chave como uma senha: quem tiver ela consegue conversar com o seu Hermes.
```

Ações: `Abrir a pasta do Hermes` (`Enter` e `Ctrl+Shift+F`),
`Abrir configurações` (`Ctrl+Shift+A`),
`Copiar o caminho do arquivo` (`Alt+Shift+C` — copia o caminho, **nunca** o conteúdo),
`Tentar detecção automática` (`Ctrl+Shift+D`), `Voltar` (`Esc`).

`Abrir a pasta do Hermes` abre a **pasta**, não o arquivo. Abrir o arquivo é escolha do usuário no
Explorador; a extensão não coloca o segredo na tela por conta própria.

### 3.8 Depois de configurar

Fluxo do brief, item por item:
1. Salvou → a extensão roda **um** teste de conexão (`/health` + `/v1/models`).
2. Passou → volta direto ao comando que o usuário tinha aberto (`pop()` até a raiz do comando e
   executa). HUD: `Conectado ao Hermes`.
3. Falhou → tela de erro correspondente de §5, sem repetir o teste sozinha.

### 3.9 Texto de `O que é isso?` (literal)

```markdown
# Por que uma chave?

O Hermes que roda no seu computador só aceita pedidos de programas que apresentem uma chave. Isso evita que qualquer site ou aplicativo aberto na sua máquina converse com o seu agente sem você saber.

A chave fica só no seu computador. Ela nunca é enviada para a internet por esta extensão, nunca aparece em telas, mensagens de erro ou registros, e você pode removê-la a qualquer momento em "Esquecer a chave detectada".
```

---

## 4. Vocabulário de estados

### 4.1 Mapeamento literal (1 para 1, sem invenção)

Fonte: 04 §2.3 e §2.4. Existem **exatamente sete** literais de `status` e sete rótulos. Nenhum
status mapeia para dois rótulos, e nenhum rótulo tem dois status.

| `status` do Hermes | Rótulo pt-BR | Ícone | Cor | Terminal? |
|---|---|---|---|---|
| `queued` | **Preparando** | `Icon.Clock` | `Color.SecondaryText` | não |
| `running` | **Executando** | `Icon.CircleProgress` | `Color.Blue` | não |
| `waiting_for_approval` | **Aguardando aprovação** | `Icon.Warning` | `Color.Orange` | não |
| `stopping` | **Interrompendo** | `Icon.Stop` | `Color.Yellow` | não |
| `completed` | **Concluído** | `Icon.CheckCircle` | `Color.Green` | sim |
| `cancelled` | **Cancelado** | `Icon.MinusCircle` | `Color.SecondaryText` | sim |
| `failed` | **Falhou** | `Icon.XMarkCircle` | `Color.Red` | sim |

Se algum nome de ícone não existir na versão instalada de `@raycast/api`, o substituto é
`Icon.Circle` — **a cor nunca muda**, porque é ela que carrega o significado à distância.

### 4.2 Implementação obrigatória

Um único módulo — **`src/lib/status.ts`**, especificado em `ARCHITECTURE.md` §3 — é a fonte dos
rótulos. Nomes normativos (use exatamente estes; não crie `run-state.ts` nem `estadoDe`):

```ts
RUN_STATUS_LABEL: Record<RunStatus, string>   // os 7 rótulos
runStatusLabel(status: string | undefined): string   // tolerante: "Desconhecido" no fallback
isTerminalRunStatus(status: string | undefined): boolean
STREAM_PHASE_LABEL / StreamPhase                     // mesmo vocabulário para o stream de conversa
```

A dupla ícone+cor da tabela §4.1 mora junto, como `RUN_STATUS_APPEARANCE: Record<RunStatus, {icon, color}>`
(é a única parte de `status.ts` que importa `@raycast/api`; se isso incomodar o teste unitário,
mova só ela para `src/lib/status-ui.ts`).
**Nenhum componente pode montar rótulo de estado por conta própria**, nem traduzir status inline, nem
usar sinônimos ("Rodando", "Em execução", "Finalizado", "Erro", "Abortado" são proibidos).

### 4.3 As duas exceções que não são estados

1. **`Execução expirada`** — `GET /v1/runs/{id}` devolveu `404 run_not_found`. Significa que o
   gateway reiniciou ou que passou o TTL de 1 hora (04 §7.1). É uma **condição de item de lista**,
   não um estado de execução. Ícone `Icon.QuestionMarkCircle`, `Color.SecondaryText`. Texto de
   detalhe: `O Hermes não tem mais informação sobre esta tarefa. Ela pode ter terminado normalmente.`
   Proibido mapear para `Falhou` ou `Cancelado`.
2. **`Sem conexão`** — condição do cliente, não do servidor. Só aparece no cabeçalho de erro de §5.

### 4.4 Regras finas do ciclo de vida (impactam a UI)

- **`waiting_for_approval` gruda.** Se a aprovação for respondida em outro lugar (Desktop, Telegram),
  `GET /v1/runs/{id}` continua dizendo `waiting_for_approval` até a run terminar (04 §2.4). Regra:
  **eventos do stream vencem o polling**; ao receber `approval.responded` ou qualquer `tool.*`
  depois de um `approval.request`, exibir **Executando** mesmo que o polling discorde.
- **`stopping` não é terminal.** Depois de `Parar`, continuar consultando até `cancelled` (ou
  `completed`, se a run terminou naturalmente na janela de corrida) (04 §6.4).
- **`"started"` do 202 não é estado.** Nunca entra no enum (04 §1.6).
- **Sem evento de parada.** `Parar` não gera evento SSE; o rótulo **Interrompendo** vem da nossa
  resposta 200 e do polling (04 §3.6.13).

---

## 5. Textos de erro

### 5.1 Regras

1. Uma frase em português explicando **o que aconteceu**, sem jargão.
2. Uma segunda frase, quando útil, dizendo **o que fazer**.
3. Ações concretas, nesta ordem quando existirem: `Tentar novamente`, `Abrir configurações`,
   `Copiar detalhes técnicos`.
4. **Detalhes técnicos ocultos por padrão.** Só aparecem com `Mostrar detalhes técnicos`
   (`Ctrl+Shift+I`) e sempre em bloco de código.
5. **Antes de exibir ou copiar**, todo detalhe técnico passa por `redigirSegredos(texto)`, que troca
   qualquer ocorrência da chave (das duas fontes de §3.3) por `[chave omitida]`. Se a chave não
   estiver carregada, o filtro ainda roda — a função nunca é pulada.
6. `error.code` e `error.type` decidem qual texto usar. **Nunca** casar por `error.message`: a
   mensagem passa por redação no servidor e pode mudar (01 §1.4).

Formato do bloco de detalhes (literal):

````markdown
### Detalhes técnicos

```
Endereço: http://127.0.0.1:8642/v1/runs
Resposta: 429
Código: rate_limit_exceeded
Momento: 19/08/2026 14:32:07
```
````

### 5.2 Catálogo

Coluna "Ações" usa as abreviações: **T** = `Tentar novamente`, **C** = `Abrir configurações`,
**D** = `Copiar detalhes técnicos`, e as extras vêm nomeadas.

| Id | Gatilho técnico | Frase literal em pt-BR | Ações |
|---|---|---|---|
| E1 | `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `AbortError` de timeout na descoberta | `Não foi possível conectar ao Hermes. Verifique se o Hermes API Server está ativo e se a URL e a chave estão corretas.` | T, C, D, `Abrir o Hermes Desktop` |
| E2 | `401` com `code: "gateway_auth_failed"` | `O Hermes não aceitou a chave de acesso. Ela pode ter mudado desde a última vez.` | `Detectar configuração automaticamente`, C, T, D |
| E3 | `/health` respondeu, mas `platform !== "hermes-agent"` | `Encontrei um programa nesse endereço, mas não é o Hermes API Server. Confira o endereço nas configurações.` | C, T, D |
| E4 | Nenhuma chave configurada | *(não é erro: renderiza a tela `SemConfiguracao` de §3.4)* | — |
| E5 | `403` com corpo vazio | `Não foi possível falar com o Hermes por causa de uma restrição de segurança do servidor.` | T, D — e registrar como bug: significa que enviamos header `Origin` (01 §5.2), o que é proibido |
| E6 | `403` com mensagem `... requires API key authentication` | `O Hermes está rodando sem chave de acesso configurada e não aceita este tipo de pedido.` | C, D |
| E7 | `404` `session_not_found` | `Esta conversa não existe mais no Hermes. Ela pode ter sido apagada no Hermes Desktop.` | `Voltar para a lista`, `Atualizar lista`, D |
| E8 | `404` `run_not_found` em uma run que acreditávamos viva | `O Hermes não tem mais informação sobre esta tarefa. Ela pode ter terminado normalmente, ou o Hermes foi reiniciado.` | `Ver conversa`, `Remover da lista`, D |
| E9 | `404` `run_not_found` ao abrir o stream de eventos | `Perdi o acompanhamento ao vivo desta tarefa, mas ela continua rodando no Hermes.` | `Acompanhar mesmo assim`, D |
| E10 | `409` `session_exists` | `Já existe uma conversa com esse identificador. Vou criar outra.` *(automático, apenas Toast informativo)* | — |
| E11 | `400` `invalid_title` | `Já existe uma conversa com esse título. Escolha outro nome.` | `Renomear`, D |
| E12 | `409` `approval_not_active` ou `approval_not_pending` | `Esse pedido de aprovação já foi respondido, talvez em outro aplicativo.` | `Atualizar`, `Voltar`, D |
| E13 | `409` `run_not_accepting_steer` / `steer_not_accepted` | `Não dá para orientar esta tarefa agora. Isso só funciona enquanto ela está executando.` | `Atualizar`, D |
| E14 | `400` `invalid_steer_input` | `Escreva a orientação antes de enviar.` | *(erro de campo no formulário)* |
| E15 | `413` `body_too_large` | `Seu texto é grande demais para o Hermes processar de uma vez. Tente dividir em partes menores.` | `Voltar e editar`, D |
| E16 | `429` `rate_limit_exceeded` | `O Hermes está com tarefas demais ao mesmo tempo. Espere alguns segundos e tente de novo.` | T (com espera automática de 2 s), D |
| E17 | `503` `gateway_draining` | `O Hermes está terminando o que já estava fazendo e não aceita novos pedidos agora. Tente de novo em instantes.` | T, D |
| E18 | `503` `session_db_unavailable` | `O Hermes não conseguiu abrir o banco de conversas. Reinicie o Hermes Desktop e tente de novo.` | T, D |
| E19 | `501` `Cron module not available` | `As automações não estão disponíveis neste Hermes.` | `Voltar`, D |
| E20 | `500` / `502` `agent_incomplete` | `O Hermes começou a tarefa mas não conseguiu terminar. Tente pedir de novo, se possível com mais detalhes.` | T, D |
| E21 | Evento `run.failed` no stream | `O Hermes não conseguiu concluir: <error do evento, já redigido pelo servidor>` | T, `Ver etapas`, D |
| E22 | Resposta do agente começa com `⚠️ Provider authentication failed` | `O modelo escolhido não está autenticado no Hermes. Abra o Hermes Desktop e configure o provedor, ou escolha outro modelo.` | `Escolher outro modelo`, `Abrir o Hermes Desktop`, D |
| E23 | Conexão caiu durante o streaming | `A conexão com o Hermes caiu no meio da resposta. A tarefa continua rodando no Hermes.` | `Acompanhar de novo`, `Ver em Execuções`, D |
| E24 | JSON inválido / resposta inesperada | `O Hermes respondeu de um jeito que a extensão não entendeu.` | T, D |
| E25 | Timeout da nossa requisição (sem resposta) | `O Hermes está demorando mais que o esperado para responder.` | T, `Parar`, D |
| E26 | Erro ao ler `.env` (permissão) | `Não consegui ler o arquivo de configuração do Hermes. Você pode configurar manualmente.` | `Configurar manualmente`, D |

### 5.3 Onde cada erro aparece

- Erro que **impede a tela inteira** (E1, E2, E3, E5, E6): substitui o conteúdo por `Detail` de erro
  (em `List`, por `List.EmptyView`).
- Erro em uma **ação pontual** (E10, E11, E12, E13, E16): `showToast` com
  `Toast.Style.Failure`, título = frase, e `primaryAction` = a primeira ação da tabela.
- Erro **durante o streaming** (E21, E23): o texto já recebido **fica na tela**; o bloco de erro é
  acrescentado abaixo, separado por `---`. Nunca apagar o que o usuário já leu.

---

## 6. A experiência de streaming

### 6.1 O que o usuário vê antes do primeiro token

`Detail` já montado, `isLoading` ativo (o Raycast desenha a barra de progresso no topo), com:

```markdown
### <pergunta do usuário, até 120 caracteres>

_Preparando…_
```

Metadata com `Estado: Preparando`. **Nunca uma tela em branco e nunca um spinner sem contexto.**
Se em 3 segundos nada tiver chegado, `_Preparando…_` vira `_O Hermes está pensando…_`. É a única
mudança de texto automática; não há mensagens rotativas.

### 6.2 Como o texto cresce

- Fonte: eventos `message.delta` do stream de `/v1/runs` — o único carregador de texto (04 §3.6.1).
- Concatenar `delta` na ordem de chegada. Não há evento de "mensagem terminou": o texto final vem em
  `run.completed.output`; ao recebê-lo, **substituir** o buffer pelo `output` (evita divergência).
- **Buffer de renderização de 80 ms**: acumular deltas e chamar `setState` no máximo ~12 vezes por
  segundo (07 §12.2, gotcha 3). Cada `setMarkdown` atravessa a ponte para o host WPF.
- Parser SSE: **não implementar aqui**. Use `createSseParser()` / `readSseFrames()` de
  `src/lib/hermes-events.ts` (`ARCHITECTURE.md` §8.2) — um `split("\n\n")` quebra com CRLF partido
  entre chunks, com `data:` multilinha e com acentos cortados no meio (`TextDecoder` precisa de
  `{stream: true}`). Comentários (`: keepalive` a cada 30 s, `: stream closed` no fim) são frames de
  comentário, nunca eventos nem fim de stream.
- **Não existe timeout de inatividade do leitor.** O timeout cobre só o tempo até os *headers*
  (`STREAM_HEADERS_TIMEOUT_MS`); depois disso o corpo pode ficar minutos em silêncio enquanto uma
  ferramenta roda, e qualquer relógio de inatividade mataria streams saudáveis
  (`ARCHITECTURE.md` §7.1 e armadilha 32). O único cancelamento é o `AbortController`.
- `AbortController` no `useEffect` + flag `cancelled`, obrigatórios (StrictMode do React 19 executa
  o efeito duas vezes em desenvolvimento e geraria duas streams intercaladas).
- Se `streamResponses` estiver desligado: nada é renderizado progressivamente; a tela fica em
  `Preparando`/`Executando` e o texto aparece de uma vez em `run.completed`.

### 6.3 As etapas (modo Etapas, `Ctrl+T`)

Por padrão o usuário vê **só a resposta**. O modo Etapas mostra, em ordem cronológica, uma linha por
evento, em linguagem simples — nunca o JSON:

| Evento | Linha exibida |
|---|---|
| `tool.started` | `🔧 Usando <tool> — <preview>` (se `preview` for nulo, só `🔧 Usando <tool>`) |
| `tool.completed` com `error: false` | `✅ <tool> concluído em 0,4 s` |
| `tool.completed` com `error: true` | `⚠️ <tool> falhou depois de 0,4 s` |
| `reasoning.available` | `💭 <text>` — recolhido: só as primeiras 100 letras, com `…` |
| `subagent.start` | `👥 Tarefa auxiliar iniciada: <goal>` |
| `subagent.complete` | `👥 Tarefa auxiliar concluída: <summary>` |
| `approval.request` | `🔐 O Hermes pediu sua aprovação` + ação para §7 |
| `approval.responded` | `🔐 Aprovação respondida: <Aprovado uma vez / Aprovado nesta execução / Aprovado sempre / Negado>` |
| `run.steered` | `🧭 Orientação enviada` |

Regras: `args` de ferramenta **não existem** neste stream (04 §3.6.2) — não inventar. Não existe
`tool.failed` aqui; falha é `tool.completed` com `error: true` (04 §3.6.3). Enquanto uma ferramenta
está em execução, o modo Resposta mostra **uma** linha discreta acima do texto
(`> 🔧 Usando <tool>…`), removida quando a ferramenta termina.

### 6.4 Ações

**Durante (estado não terminal):**

| Título | Atalho | Condição |
|---|---|---|
| `Parar` | `Ctrl+Shift+P` | sempre; ver §6.6 |
| `Orientar execução` | `Ctrl+Shift+G` | somente quando o estado for exatamente `Executando` |
| `Copiar o que já veio` | `Ctrl+Shift+C` | quando há texto |
| `Ver etapas` / `Ver resposta` | `Ctrl+T` | sempre |
| `Abrir no Hermes Desktop` | `Ctrl+O` | quando há conversa |
| `Copiar detalhes técnicos` | `Ctrl+Alt+C` | sempre |

**Depois (Concluído):**

| Ordem | Título | Atalho |
|---|---|---|
| 1 | `Copiar resposta` | `Ctrl+Shift+C` |
| 2 | `Colar no aplicativo ativo` | `Ctrl+Shift+V` |
| 3 | `Continuar esta conversa` | `Ctrl+Shift+Return` |
| 4 | `Nova conversa` | `Ctrl+N` |
| 5 | `Abrir no Hermes Desktop` | `Ctrl+O` |
| 6 | `Ver etapas` | `Ctrl+T` |
| 7 | `Ramificar conversa` | `Ctrl+Shift+B` |
| 8 | `Renomear conversa` | `Ctrl+E` |
| 9 | `Copiar detalhes técnicos` | `Ctrl+Alt+C` |

`Perguntar de novo` **não** entra neste painel: com `Nova conversa` (`Ctrl+N`) ao lado ela seria a
mesma ação com outro nome, e a versão anterior desta tabela a dava com `Ctrl+R`, que §9.2 reserva
para `Atualizar`/`Tentar novamente`. Ela existe só onde `Nova conversa` não existe (§2.5 e o painel
de Falhou/Cancelado abaixo), sempre com `Ctrl+N`.

`Colar no aplicativo ativo` usa `Action.Paste`; após colar, `closeMainWindow()` e
`showHUD("Resposta colada")`.

**Depois (Falhou / Cancelado):** as ações de erro de §5 primeiro, depois
`Copiar o que já veio` (`Ctrl+Shift+C`), `Perguntar de novo` (`Ctrl+N`),
`Continuar esta conversa` (`Ctrl+Shift+Return`).

### 6.5 Fechar a janela do Raycast no meio do streaming

**Comportamento (motor `/v1/runs`, ver §0.2):**

1. A run **continua rodando no Hermes**. Fechar a janela nunca cancela nada. Só `Parar` cancela
   (04 §8.1). Isso é o princípio 8 do brief, cumprido de verdade.
2. O stream de eventos **é perdido para sempre** — não é retomável, e reconectar devolve 404
   (04 §3.3). Isso é limitação do servidor, não escolha de UI.
3. Por isso, todo evento recebido é gravado em `LocalStorage` **enquanto chega**, especialmente
   `approval.request` (04 §8.3). Ao reabrir, a tela é remontada com o histórico local.
4. Reabrindo a mesma execução: a extensão mostra o histórico local e passa a consultar
   `GET /v1/runs/{run_id}` a cada 2 s. Isso dá estado, `last_event`, e — quando terminar — `output`,
   `usage` e `error`. Não há reprodução dos deltas perdidos.
5. Aviso literal exibido no topo do markdown quando a tela é remontada sem stream:
   `> Acompanhando esta tarefa em modo simples. O texto que passou enquanto o Raycast estava fechado não pode ser recuperado, mas o resultado final aparece aqui.`

**Como o usuário volta para a tarefa (três caminhos, todos descobríveis):**

- `Execuções do Hermes` lista tudo, com a seção `Em andamento` no topo.
- `Perguntar ao Hermes` mostra o banner `Você tem N tarefas em andamento no Hermes.` com a ação
  `Ver tarefas em andamento` (`Ctrl+Shift+E`).
- Ao terminar sem ninguém olhando, na próxima abertura de qualquer comando aparece um Toast:
  `Sua tarefa terminou.` com `primaryAction` = `Ver resultado`.

> **Variante V-1b** — usar **somente** se o teste V-1 de §0.2 falhar e `Perguntar ao Hermes` migrar
> para `/api/sessions/{id}/chat/stream`. Nesse transporte, fechar a janela **interrompe** o turno
> (04 §8.2). Então: (a) `Perguntar ao Hermes` ganha, durante o streaming, a linha fixa
> `> Mantenha o Raycast aberto até a resposta terminar.`; (b) ao ser interrompida assim, a conversa
> mostra `Cancelado` e a ação `Continuar esta conversa`; (c) o texto parcial fica salvo em `state.db`
> e visível no Hermes Desktop; (d) `Executar tarefa no Hermes` continua em `/v1/runs` e mantém
> integralmente o texto de §6.5 acima, e a tela de entrada de §2.1.1 ganha a ação
> `Executar como tarefa em segundo plano` (`Ctrl+Shift+X`).

### 6.6 `Parar`

1. `POST /v1/runs/{run_id}/stop` (corpo ignorado pelo servidor — 04 §6.1).
2. `200` → estado vira **Interrompendo** na hora. Não há evento SSE de parada.
3. Continuar consultando `GET /v1/runs/{run_id}` até `cancelled` (ou `completed`, se venceu a corrida).
4. `404` → a run já tinha terminado: tratar como **Concluído**/**Cancelado** conforme o último
   estado conhecido, **nunca** como erro (04 §6.2).
5. Texto durante a espera, no topo do markdown:
   `> Pedido de parada enviado. O Hermes está encerrando com segurança — isso pode levar alguns segundos se ele estiver no meio de uma ferramenta.`
6. Sem `confirmAlert`: parar é reversível no sentido em que nada é destruído, e exigir confirmação
   atrasaria a única saída de emergência do usuário.

### 6.7 `Orientar execução` (steer)

`Action.Push` de um `Form` de um campo:
`Form.TextArea` `title="O que você quer ajustar"`,
`placeholder="Ex.: seja mais breve e foque no custo."`, `autoFocus`.
Envia `POST /v1/runs/{run_id}/steer {"input": texto}`.
Só está no painel quando o estado é exatamente `Executando` (04 §5.3).
Sucesso → HUD `Orientação enviada`; a linha `🧭 Orientação enviada` entra nas Etapas.
`409` → E13.
Se o `run.completed` trouxer `pending_steer`, exibir abaixo da resposta:
`> Sua orientação chegou depois que o Hermes terminou. Quer enviá-la como próxima pergunta?` com a
ação `Enviar como nova pergunta`.

---

## 7. Aprovações (superfície de segurança)

### 7.1 Princípios

- **Nunca aprovar automaticamente.** Nenhuma preferência, nenhum "lembrar minha escolha", nenhuma
  ação em lote a partir de uma lista. A decisão é sempre em tela cheia, com o comando visível.
- **Nunca inventar informação.** O evento traz `command`, `description`, `pattern_key`,
  `pattern_keys`, `allow_permanent`, `allow_session`, `smart_denied`, `request_id`, `choices`.
  **Não traz `tool_name` nem `args`** (D5). É proibido rotular a ação com um nome de ferramenta
  deduzido.
- **As opções vêm do servidor.** Renderizar exatamente o array `choices` do evento, nunca uma lista
  fixa (04 §4.2). Combinações possíveis: `["once","session","always","deny"]`,
  `["once","session","deny"]`, `["once","deny"]`.
- Toda solicitação de aprovação é, por definição, uma ação que passou por uma barreira de comando
  perigoso. Não existe aprovação "inofensiva" nesta tela.

### 7.2 Tela de aprovação — `Detail`

`navigationTitle`: `Aprovação necessária`.

**Markdown (literal, com os campos substituídos):**

````markdown
# O Hermes precisa da sua permissão

Ele quer executar este comando no seu computador:

```
<command>
```

**Por que estamos perguntando:** <description>

<bloco de risco, ver 7.3>

Se você não reconhece este comando ou não pediu nada parecido, escolha **Negar**.
````

`Detail.Metadata`:

```
Tarefa            <primeiros 60 caracteres do prompt>
Conversa          <título>
Estado            Aguardando aprovação
Tipo de bloqueio  <pattern_key>
Identificador     <request_id, primeiros 8 caracteres>
```

`pattern_key` aparece cru de propósito: é o único identificador confiável do tipo de bloqueio e
ajuda quem for pedir suporte. Fica na metadata, não no corpo, para não competir com o texto simples.

### 7.3 Marcação visual de risco

Bloco inserido no markdown, escolhido por `pattern_keys`:

- Se algum `pattern_key` estiver na lista de destrutivos conhecidos
  (`rm-rf`, `del`, `format`, `drop`, `truncate`, `shutdown`, `reg-delete`, `git-push-force`,
  ou qualquer chave contendo `delete`/`remove`/`destroy`/`force`):

```markdown
> ⛔ **Ação destrutiva.** Este comando pode apagar ou sobrescrever arquivos de forma definitiva. Só aprove se você entende exatamente o que ele faz.
```

- Caso contrário:

```markdown
> ⚠️ **Ação sensível.** Este comando pode alterar arquivos ou executar programas no seu computador.
```

- Se `smart_denied === true` (o servidor já havia negado e só oferece `once`/`deny`):

```markdown
> 🛑 **O Hermes recomendou negar esta ação.** Aprovar vale só para esta única vez.
```

Nas listas (`Execuções do Hermes`, Etapas), um item aguardando aprovação recebe
`accessory { tag: { value: "Aguardando aprovação", color: Color.Orange } }`, e quando o padrão é
destrutivo, `icon: { source: Icon.ExclamationMark, tintColor: Color.Red }`.

### 7.4 Ações e confirmações

| `choice` | Título literal | Atalho | `style` | Confirmação extra |
|---|---|---|---|---|
| `once` | `Aprovar só esta vez` | `Enter` | regular | não — esta tela **é** a confirmação |
| `session` | `Aprovar durante esta execução` | `Alt+Shift+E` | regular | `confirmAlert` |
| `always` | `Aprovar sempre este tipo de comando` | `Alt+Shift+S` | **destructive** | `confirmAlert` obrigatório |
| `deny` | `Negar` | `Ctrl+Shift+N` | regular | não |
| — | `Copiar comando` | `Ctrl+Shift+C` | regular | — |
| — | `Ver etapas da tarefa` | `Ctrl+T` | regular | — |

`confirmAlert` de `session` (literal):

```
title:   "Aprovar durante toda esta execução?"
message: "O Hermes vai poder repetir comandos parecidos até esta tarefa terminar, sem perguntar de novo."
primaryAction:  { title: "Aprovar durante esta execução", style: Alert.ActionStyle.Default }
dismissAction:  { title: "Cancelar", style: Alert.ActionStyle.Cancel }
```

`confirmAlert` de `always` (literal):

```
title:   "Aprovar sempre este tipo de comando?"
message: "Comandos parecidos com este passam a ser executados sem pedir sua permissão, agora e no futuro, em qualquer conversa. A regra vale para o padrão do comando, não só para este texto exato. Você pode desfazer isso no Hermes Desktop."
primaryAction:  { title: "Aprovar sempre", style: Alert.ActionStyle.Destructive }
dismissAction:  { title: "Cancelar", style: Alert.ActionStyle.Cancel }
rememberUserChoice: false
```

`rememberUserChoice` é **sempre** `false` em toda a extensão. Uma confirmação lembrada anularia a
própria confirmação.

### 7.5 Fila FIFO — o aviso obrigatório

A API **não aceita** `request_id` no corpo: ela resolve sempre o pedido **mais antigo** da fila
(04 §4.2). Consequências que a UI deve tratar:

- Se houver mais de um pedido pendente para a mesma run, exibir acima das ações:
  `> Existem <N> pedidos de aprovação nesta tarefa. Sua resposta vale para o mais antigo deles.`
- Nunca oferecer "aprovar todos" (`resolve_all`) no MVP: aprovar em lote coisas que o usuário não
  leu é exatamente o que a barreira existe para impedir.
- Após responder, `POST` retorna `{choice, resolved}`. Se `resolved > 1`, mostrar
  `Toast`: `<resolved> pedidos foram respondidos de uma vez.`

### 7.6 Aprovação sem detalhes (janela foi fechada)

Se `GET /v1/runs/{id}` disser `waiting_for_approval` e não houver `approval.request` no
`LocalStorage` (04 §8.3):

```markdown
# Aprovação pendente

O Hermes está esperando uma resposta sua para continuar, mas os detalhes do pedido se perderam quando o Raycast foi fechado.

Sem ver o comando, a escolha segura é negar. Você pode pedir a tarefa de novo e deixar o Raycast aberto para ver o pedido completo.
```

Ações: `Negar` (`Enter`, primeira ação — aqui o padrão seguro vira o padrão),
`Aprovar mesmo sem ver os detalhes` (**sob decisão P4**: `ARCHITECTURE.md` armadilha 24 diz para
oferecer só `Negar` nesta situação; se P4 for negada, remover esta ação e as duas linhas seguintes)
(`Alt+Shift+E`, `style: destructive`, `confirmAlert` com
`title: "Aprovar sem ver o comando?"` e
`message: "Você vai autorizar um comando que não está sendo exibido. Só faça isso se tiver certeza do que pediu ao Hermes."`),
`Parar tarefa` (`Ctrl+Shift+P`), `Abrir no Hermes Desktop` (`Ctrl+O`).

### 7.7 Tempo limite

O agente fica bloqueado esperando (padrão 300 s no servidor). Texto no rodapé da tela:
`O Hermes está parado esperando sua resposta. Se ninguém responder, ele desiste sozinho depois de alguns minutos.`
Não exibir contagem regressiva: o valor é configurável no servidor e um contador errado seria pior
que nenhum.

---

## 8. Sincronização com o Hermes Desktop

### 8.1 A promessa, dita ao usuário

A frase canônica, usada sem variação (§10.3):
`Suas conversas do Raycast também aparecem no Hermes Desktop.`

### 8.2 Onde essa promessa fica visível (descobribilidade)

1. **Tela de sucesso do primeiro uso** (§3.5) — última linha.
2. **`Verificar conexão`** (§2.7) — última linha do sucesso.
3. **Estado vazio de `Conversas do Hermes`** (§2.2.2) — na `description`.
4. **Metadata da resposta** (§2.1.3) — campo `Sincronização` com valor `Aparece no Hermes Desktop`.
5. **Toast após a primeira resposta de uma conversa nova**, uma vez por conversa:
   `title: "Esta conversa já está no Hermes Desktop"`,
   `primaryAction: { title: "Abrir no Hermes Desktop" }`.
   Só na primeira; repetir vira ruído.
6. **Accessory nos itens de lista** — `Criada no Raycast` / `Do Hermes Desktop` (§2.2).

Uma conversa **ramificada** (fork) é a única exceção visível: o filho é carimbado
`source: "api_server"` pelo servidor e `source` não é patchável (06 R7), então ele **não** aparece
em Recentes do Desktop. Ao ramificar, o Toast de sucesso (§10.4) ganha a segunda linha literal:
`Esta nova conversa não aparece na lista principal do Hermes Desktop.`

### 8.3 Latência — o que dizer e o que não dizer

Propagação típica de 1 a 3 segundos, pior caso ~12 s (06 §9.1). Não prometer "instantâneo" e não
mostrar número. Quando o usuário aciona `Abrir no Hermes Desktop` numa conversa criada há menos de
5 segundos, mostrar antes:
`showHUD("Abrindo no Hermes Desktop. Pode levar alguns segundos para a conversa aparecer lá.")`.

### 8.4 `Abrir no Hermes Desktop`

- Implementação: `Action.Open` com `target = "hermes://open/" + encodeURIComponent(sessionId)`
  (06 §8.3). Título literal: `Abrir no Hermes Desktop`. Atalho `Ctrl+O`. Ícone `Icon.Desktop`.
- **Onde aparece:** item de `Conversas do Hermes`; tela de detalhe da conversa; `Detail` da resposta
  (durante e depois); item de `Execuções do Hermes` que tenha conversa; tela de aprovação.
- **Onde NÃO aparece:** execuções sem conversa real; conversas ainda sem nenhuma mensagem.
- O Desktop pode não estar aberto. O `hermes://` é registrado pelo instalador; se nada acontecer, o
  usuário não recebe erro do sistema. Mitigação: mostrar sempre, junto, a ação secundária
  `Copiar identificador da conversa` (`Ctrl+Alt+C`), e no rodapé da tela de detalhe da conversa:
  `Se nada abrir, verifique se o Hermes Desktop está instalado e rodando.`

### 8.5 Cadência de atualização (primeiro plano)

Não existe canal de push do Hermes para um cliente HTTP externo (06 R6). Toda atualização é nossa.

| Superfície | Cadência | Regra de parada |
|---|---|---|
| `Conversas do Hermes` | revalidar ao abrir + a cada **4 s** | para ao empilhar outra tela ou ao fechar a janela |
| Detalhe da conversa | revalidar ao abrir + a cada **6 s** | idem |
| `Execuções do Hermes` | **2 s** enquanto houver run não terminal | para quando todas forem terminais |
| Execução aberta sem stream | **2 s** | para no estado terminal |
| Endpoint resolvido (`/health`) | `LocalStorage`, **12 h** + invalidação pelo pid do gateway | `invalidateBaseUrl()` em `ECONNREFUSED` |
| Primeira página de `/api/sessions` | `Cache` de **30 s**, só para pintura instantânea | sempre revalidar por cima |
| `/v1/capabilities` | `Cache` de **5 min** | invalidar ao mudar `apiUrl` |
| `/api/model/options` | `Cache` de **10 min** | invalidar em `Atualizar lista` |
| `/v1/skills` (fase 2) | `Cache` de **5 min** (o servidor já cacheia 30 s) | — |
| `/v1/toolsets` (fase 2) | `Cache` de **15 min**, carregado sob demanda | chamada lenta (02 §5.7) |

Os valores desta coluna são os de `CacheTtl` em `ARCHITECTURE.md` §9.2 — não duplicar constantes.

Todo polling usa `AbortController` e é cancelado no `useEffect` de limpeza. Nenhum polling roda em
`no-view` nem em background: a extensão não gasta bateria quando ninguém está olhando.

### 8.6 Conflito de escrita

Duas superfícies escrevem nas mesmas linhas e não existe trava entre elas (06 R9). Regra de UI:
antes de continuar uma conversa cujo `last_active` seja mais recente que 30 segundos **e** que não
tenha sido criada no Raycast, exibir uma vez:
`> Esta conversa foi usada há pouco no Hermes Desktop. Se ela estiver aberta lá, espere a resposta terminar antes de continuar por aqui.`
Não bloquear — apenas avisar.

### 8.7 Higiene de dados

- Guardar em `LocalStorage`, e só: registros de execução (§0.2), a última conversa usada, o modelo padrão da extensão e o modelo do próximo envio,
  `approval.request` pendentes e — **se e somente se P1 for aprovada** — a chave detectada.
  As chaves literais estão em `StorageKeys` (`ARCHITECTURE.md` §9.2); não inventar outras.
- **Não** cachear transcrições completas por padrão (regra de segurança do brief). A única exceção é
  o resultado final de um run iniciado aqui (`output`/`error` truncados), porque o servidor descarta
  o status terminal em 1 h — poda em 24 h.
- Limpeza: **máximo de 20 registros de execução**, poda dos terminais com mais de 7 dias na abertura
  de `Execuções do Hermes` (`ARCHITECTURE.md` §9.1/§9.2 — os números vêm de lá).

---

## 9. Mapa de teclado

### 9.1 Regras

- **Nunca usar `cmd`.** No Windows um atalho com `cmd` é silenciosamente ignorado (07 §8.1).
  Modificadores válidos: `ctrl`, `shift`, `alt`, `windows`. Só usamos os três primeiros.
- Preferir `Keyboard.Shortcut.Common.*` quando existir equivalente semântico — o Raycast já traduz
  para Windows (07 §8.4).
- Reservados pelo Raycast e proibidos para nós: `Enter` (ação primária), `Ctrl+K` (painel de ações),
  `Esc` (voltar), setas e `Tab` (navegação).
- **Nenhuma ação órfã:** toda ação está no `ActionPanel`, alcançável por `Ctrl+K` + setas + `Enter`.
  Atalho é aceleração, nunca a única porta.
- Um mesmo significado tem sempre o mesmo atalho em todos os comandos.

### 9.2 Tabela global

| Atalho | `Keyboard.Shortcut` | Ação | Onde |
|---|---|---|---|
| `Enter` | — | Ação primária da tela | todas |
| `Ctrl+Shift+C` | `Common.Copy` | `Copiar resposta` / `Copiar comando` / `Copiar mensagem` | resposta, aprovação, conversa |
| `Ctrl+Shift+V` | `{ modifiers: ["ctrl","shift"], key: "v" }` | `Colar no aplicativo ativo` | resposta |
| `Ctrl+Shift+Return` | `{ modifiers: ["ctrl","shift"], key: "return" }` | `Continuar esta conversa` | resposta, conversas |
| `Ctrl+N` | `Common.New` | `Nova conversa` / `Perguntar de novo` | resposta, execuções |
| `Ctrl+O` | `Common.Open` | `Abrir no Hermes Desktop` | conversas, resposta, execuções, aprovação |
| `Ctrl+Shift+P` | `{ ["ctrl","shift"], "p" }` | `Parar` | resposta, execuções |
| `Ctrl+Shift+G` | `{ ["ctrl","shift"], "g" }` | `Orientar execução` | resposta, execuções |
| `Ctrl+T` | `{ ["ctrl"], "t" }` | `Ver etapas` / `Ver resposta` | resposta, aprovação |
| `Ctrl+Shift+I` | `{ ["ctrl","shift"], "i" }` | `Mostrar detalhes técnicos` | erros, conexão |
| `Ctrl+Alt+C` | `{ ["ctrl","alt"], "c" }` | `Copiar detalhes técnicos` / `Copiar conversa inteira` | erros, conversa |
| `Ctrl+R` | `Common.Refresh` | `Atualizar` / `Tentar novamente` | listas, erros |
| `Ctrl+Shift+A` | `{ ["ctrl","shift"], "a" }` | `Abrir configurações` | todas |
| `Ctrl+Shift+T` | `{ ["ctrl","shift"], "t" }` | `Testar conexão` | conexão, configurar |
| `Ctrl+Shift+D` | `{ ["ctrl","shift"], "d" }` | `Detectar configuração automaticamente` | configurar, conexão, erro E2 |
| `Ctrl+Shift+F` | `{ ["ctrl","shift"], "f" }` | `Abrir a pasta do Hermes` | configurar |
| `Alt+Shift+C` | `Common.CopyPath` | `Copiar o caminho do arquivo` | configurar |
| `Ctrl+E` | `Common.Edit` | `Renomear conversa` | conversas, resposta |
| `Ctrl+.` | `Common.Pin` | `Fixar` / `Desafixar conversa` | conversas |
| `Alt+A` | `{ ["alt"], "a" }` | `Arquivar` / `Desarquivar conversa` | conversas |
| `Ctrl+D` | `Common.Remove` | `Excluir conversa` / `Remover da lista` / `Esquecer a chave detectada` | conversas, execuções, configurar |
| `Ctrl+Shift+B` | `{ ["ctrl","shift"], "b" }` | `Ramificar conversa` | conversas, resposta |
| `Ctrl+Shift+M` | `{ ["ctrl","shift"], "m" }` | `Usar só na próxima pergunta` | modelos |
| `Ctrl+Shift+E` | `{ ["ctrl","shift"], "e" }` | `Ver tarefas em andamento` | ask, run-task |
| `Ctrl+Shift+N` | `{ ["ctrl","shift"], "n" }` | `Negar` | aprovação |
| `Alt+Shift+E` | `{ ["alt","shift"], "e" }` | `Aprovar durante esta execução` | aprovação |
| `Alt+Shift+S` | `{ ["alt","shift"], "s" }` | `Aprovar sempre este tipo de comando` | aprovação |

`Ctrl+Shift+X` fica **reservado** para `Executar como tarefa em segundo plano`, usado apenas na
variante V-1b (§6.5).

### 9.3 Conflitos evitados e por quê

- `Common.Duplicate` no Windows é `Ctrl+Shift+S`; não usamos `Duplicate` em lugar nenhum, então
  `Alt+Shift+S` para "aprovar sempre" não colide.
- `Common.RemoveAll` (`Ctrl+Shift+D`) não é usado; o atalho foi reservado para "detectar
  configuração", que nunca convive com uma ação de remoção em massa.
- `Common.CopyName` (`Ctrl+Alt+C`) não é usado com esse significado; o atalho serve a "copiar
  detalhes técnicos", que nunca aparece na mesma tela que uma ação "copiar nome".
- `Ctrl+,` e `Ctrl+K` não são usados: pertencem ao Raycast.

### 9.4 Operabilidade total por teclado — checklist de aceite

- [ ] Abrir cada comando, chegar ao resultado e voltar usando só o teclado.
- [ ] Em cada tela, `Ctrl+K` lista **todas** as ações disponíveis naquele contexto.
- [ ] Nenhuma ação existe apenas como atalho sem entrada no `ActionPanel`.
- [ ] Formulários: `Tab` percorre os campos na ordem visual; `Enter` envia; `Esc` volta.
- [ ] Alerta de confirmação: `Enter` aciona a ação primária, `Esc` cancela.
- [ ] Toast com ação: o atalho declarado no `primaryAction` funciona sem tirar o foco da lista.

---

## 10. Guia de escrita

### 10.1 Tom

- Segunda pessoa direta ("você"), verbos no presente, frases curtas.
- Sem "Ops!", sem "Oops", sem emoji em título de tela, sem exclamações. Emoji só nas linhas de
  Etapas (§6.3) e nos blocos de risco (§7.3), onde são semáforo, não decoração.
- Erro descreve o fato e o próximo passo. Nunca culpa o usuário, nunca pede desculpas duas vezes.
- Nunca dizer "API", "endpoint", "token", "payload", "SSE", "JSON", "stream", "run", "session" em
  texto visível. Esses termos só existem nos detalhes técnicos ocultos.
- Números com vírgula decimal (`0,4 s`). Datas por extenso curto (`12 de agosto`).
- Ações são verbos no infinitivo (`Copiar resposta`, `Abrir configurações`), nunca substantivos.
- Títulos de tela em frase, com maiúscula só na primeira palavra e nos nomes próprios
  (`Aprovação necessária`, `Conecte o Raycast ao seu Hermes`).

### 10.2 Glossário — o termo fixo de cada conceito

| Conceito interno | Termo em pt-BR na interface | Nunca usar |
|---|---|---|
| session | **conversa** | sessão, chat, thread, histórico |
| run (curto, disparado por Perguntar) | **resposta** (o resultado) / **tarefa** (o trabalho) | run, execução, job |
| run (longo, disparado por Executar tarefa) | **tarefa** | run, job, processo |
| lista de runs | **execuções** *(só o título do comando `Execuções do Hermes`)* | runs, jobs |
| run_id | **identificador da tarefa** *(só em detalhes técnicos)* | run id, ID |
| skill | **skill** *(mantido; é o nome que o usuário vê no Hermes Desktop)* | habilidade, competência |
| toolset | **ferramentas** (grupo: **grupo de ferramentas**) | toolset, kit |
| tool | **ferramenta** | tool, função |
| job / cron | **automação** | job, cron, agendamento |
| provider | **provedor** | provider, fornecedor |
| model | **modelo** | model, LLM, IA |
| streaming | **enquanto é escrita** / **na hora** | streaming, stream |
| approval | **aprovação** / **permissão** | approval, autorização |
| steer | **orientar** | steer, direcionar, guiar |
| stop | **parar** | cancelar, abortar, interromper |
| fork | **ramificar** | fork, bifurcar, duplicar |
| API key | **chave de acesso** | token, API key, senha |
| API Server | **Hermes** *(para o usuário, o Hermes é um só)* | API server, gateway, backend |
| Hermes Desktop | **Hermes Desktop** *(sempre com as duas palavras)* | Desktop, app |
| pinned | **fixada** | pin, favorita |
| archived | **arquivada** | oculta, removida |

**Nota sobre "parar" e "cancelar":** `Parar` é a ação; **Cancelado** é o estado resultante. São
palavras diferentes de propósito e não devem ser trocadas.

### 10.3 Frases canônicas (usar sem variação)

```
Suas conversas do Raycast também aparecem no Hermes Desktop.
Não foi possível conectar ao Hermes. Verifique se o Hermes API Server está ativo e se a URL e a chave estão corretas.
A tarefa continua rodando no Hermes mesmo se você fechar o Raycast.
A chave não é exibida em nenhum momento.
Tentar novamente
Abrir configurações
Copiar detalhes técnicos
Abrir no Hermes Desktop
Continuar esta conversa
Nova conversa
Sem título
```

`Não foi possível conectar ao Hermes...` é a frase exigida pelo brief e é usada literalmente em E1,
inclusive na quebra de linha entre as duas sentenças quando renderizada em Markdown.

### 10.4 Mensagens de sucesso (HUD e Toast)

| Situação | Texto literal | Componente |
|---|---|---|
| Copiou resposta | `Resposta copiada` | HUD |
| Colou resposta | `Resposta colada` | HUD |
| Conectou pela primeira vez | `Conectado ao Hermes` | HUD |
| Renomeou | `Conversa renomeada` | Toast Success |
| Fixou | `Conversa fixada` | Toast Success |
| Arquivou | `Conversa arquivada` | Toast Success |
| Excluiu | `Conversa excluída` | Toast Success |
| Ramificou | `Nova conversa criada a partir desta` | Toast Success com `primaryAction: "Abrir a nova conversa"` |
| Parou | `Parando a tarefa…` | Toast Animated, vira `Tarefa parada` |
| Orientou | `Orientação enviada` | HUD |
| Aprovou uma vez | `Aprovado. O Hermes vai continuar.` | Toast Success |
| Negou | `Negado. O Hermes vai seguir sem essa ação.` | Toast Success |
| Modelo padrão | `Modelo padrão da extensão atualizado.` | Toast Success |
| Esqueceu a chave | `Chave removida deste computador.` | Toast Success |

### 10.5 Textos que precisam de revisão humana antes do release

Marcados aqui porque decidem confiança: §3.4, §3.5, §3.7, §3.9, §5.2 (E1, E2, E22), §7.2, §7.4, §7.6.

---

## 11. Definição de pronto por tela

Uma tela só está pronta quando:

- [ ] tem estado de carregamento, vazio, sucesso e erro, todos com texto em pt-BR desta spec;
- [ ] usa `runStatusLabel()` / `RUN_STATUS_APPEARANCE` de `src/lib/status.ts` para qualquer rótulo de
      estado — nunca string solta;
- [ ] é 100% operável por teclado e nenhuma ação está fora do `ActionPanel`;
- [ ] não exibe, não registra e não copia a chave de acesso, nem parcialmente;
- [ ] cancela streams e pollings no `useEffect` de limpeza, com `AbortController`;
- [ ] não usa `cmd` em nenhum atalho;
- [ ] toda operação destrutiva passa por `confirmAlert` com `rememberUserChoice: false`;
- [ ] nenhum termo do glossário aparece com sinônimo proibido;
- [ ] `npx ray lint` e `npx ray build` passam, e a tela foi exercitada contra o Hermes real.

## 12. Pendências marcadas para a implementação

| Id | Pendência | Efeito se ignorada |
|---|---|---|
| V-1 | `/v1/runs` com `session_id` persiste as mensagens na conversa? (§0.2) | Escolhe o motor de `Perguntar ao Hermes` e o texto de §6.5. É a decisão pendente **P2**; até lá vale o default conservador de §0.2 |
| ~~V-2~~ | ~~`hermes://open/<id>`~~ — **RESOLVIDA**: confirmada ao vivo nesta máquina | — |
| V-3 | Comportamento exato no fim do tempo limite de aprovação (§7.7) | Só afeta a frase de rodapé, escrita para ser verdadeira nos dois casos |
| V-4 | Nomes de ícone (`Icon.CircleProgress`, `Icon.MinusCircle`, `Icon.Stop`) na versão instalada | Fallback `Icon.Circle`, cor preservada (§4.1) |
| V-5 | O Raycast para Windows mantém um comando `view` vivo por quanto tempo após fechar a janela | Só afeta quantas vezes o usuário verá o aviso de §6.5, não a correção |

**Decisões humanas, não verificações** — estão em `ARCHITECTURE.md` → "Decisões pendentes" e
bloqueiam as seções indicadas: **P1** (ler `API_SERVER_KEY` do `.env` — bloqueia §3.1/§3.5/§3.6),
**P2** (motor de `Perguntar ao Hermes` — §0.2/§6.5), **P3** (onde vive o modelo padrão — §2.6),
**P4** (permitir `Aprovar mesmo sem ver os detalhes` — §7.6).
