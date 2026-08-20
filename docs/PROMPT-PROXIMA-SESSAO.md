Continue a extensão Raycast para o Hermes Agent, em
C:\Users\SAM\Desktop\Projetos\Plugin RayCast

## LEIA PRIMEIRO, NESTA ORDEM (a de número menor vence em conflito)

1. `docs/DECISOES-VERIFICADAS.md` — decisões provadas contra o Hermes real.
   **A D-04 foi REVISADA**: `jobs_admin` não governa nada, e a tela de
   Automações funciona. Leia a versão nova antes de qualquer coisa.
2. `docs/UX-SPEC.md` — spec tela a tela, textos literais em pt-BR, os 7 rótulos
   de estado. Tem divergências conhecidas com o código; ver "Pendências" abaixo.
3. `docs/ARCHITECTURE.md` — contratos dos módulos e armadilhas.
4. `INSTRUCOES_DO_PROJETO.md` — brief de produto e regras de engenharia.
5. `docs/research/*.md` — detalhe de campo, com citações arquivo:linha.

## ESTADO (verificado rodando, não relatado)

```
npx tsc --noEmit -p tsconfig.json         exit 0
npx tsc --noEmit -p tests/tsconfig.json   exit 0
node --test "tests/**/*.test.ts"          182 passando, 0 falhando
npx ray lint                              exit 0
npx ray build --target release            exit 0
```

**A extensão roda de verdade dentro do Raycast.** Conecta, detecta a chave
sozinha, pergunta e responde. Isso foi confirmado pelo usuário na sessão de
2026-08-19.

## A ARMADILHA DE BUILD — não redescubra

O CLI `@raycast/api` 1.104.x usa flavor `x` no Windows e grava em
`~/.config/raycast-x/extensions/hermes/`. O app Raycast 2.0.3 lê
`~/.config/raycast/extensions/<uuid || nome>/<comando>.js`. Era isso o
`Error: Missing executable` — o build sempre esteve certo, a pasta é que era a
antiga.

O flag oculto `--target release` corrige, e **já está nos scripts**. Use
`npm run dev` (que é `ray develop --target release`) e deixe rodando — é
literalmente o que o botão "Start Development" do Raycast executa.

## A PRÓXIMA TAREFA: deixar o uso fluido

Este é o pedido literal do usuário ao fim da sessão anterior: *"Ele responde
mas não tem como interagir mais que isso, quero deixar mais fluido o uso"*.

**O diagnóstico já está feito, não refaça.** `Continuar esta conversa` existe
em `src/ask.tsx`, mas:

- está na **segunda** seção do `ActionPanel`, abaixo de Copiar e Colar, então
  não é a ação primária e só aparece no `Ctrl+K`;
- ela empurra um **formulário novo**, e o formulário empurra uma **tela nova**.
  Cada turno vira uma tela empilhada e o usuário **nunca vê a troca anterior**.

Ou seja: funciona como pergunta-e-resposta avulsa, não como conversa. É lacuna
de produto, não defeito.

Antes de implementar, **use a skill de brainstorming e alinhe com o usuário**,
porque isto muda a tela principal do produto. Duas direções conhecidas:

- **A — thread no `Detail`.** Acumular os turnos no mesmo markdown e promover
  `Continuar esta conversa` a ação primária depois de concluído. Menor risco,
  mantém tudo o que existe. Conflita com a §6.4 da UX-SPEC, que hoje lista essa
  ação só em "Depois (Concluído)" e põe `Copiar resposta` como primária.
- **B — padrão de chat do Raycast.** `List` com a barra de busca fazendo as
  vezes de composer: cada mensagem é um item, `Enter` envia. É o padrão nativo
  para chat no Raycast e é o mais fluido. Reescreve a tela principal.

Ainda sem resposta e **só resolvível teclando na máquina**: `Enter` envia um
`Form` com `Form.TextArea` em foco no Raycast Windows, ou quebra a linha?
`docs/research/07-...md:68-70` marca como UNVERIFIED e três seções da UX-SPEC
assumem que sim. A direção B depende disso.

## DEPOIS, NESTA ORDEM

### 1. Fase 2 — os comandos que faltam

O levantamento pesado já foi feito e os contratos foram verificados **ao vivo**:

- `GET /v1/skills` → `{object:"list", data:[{name, description, category}]}`.
  140 skills neste servidor; `category` pode ser `null`. Tipos já existem em
  `src/lib/types.ts`.
- `GET /v1/toolsets` → seis campos por toolset. **Cuidado real**: o handler roda
  no event loop do aiohttp e pode disparar um `urlopen` síncrono de 8 s ao
  portal da Nous (`hermes_cli/nous_account.py:595`), travando o Hermes inteiro.
  Cache de 10 min no cliente, `AbortController` de 12 s, nunca em background.
- `GET /api/jobs?include_disabled=true` → 200. **O parâmetro é obrigatório**:
  sem ele o servidor filtra jobs desabilitados, e esta máquina tem um job
  pausado que sumiria da tela.

Passo 0 obrigatório, antes de qualquer comando novo: **extrair `AnswerView` de
`src/ask.tsx` para `src/components/answer-view.tsx`**. Hoje ela é privada
(`src/ask.tsx:398`, sem `export`) e é exatamente o componente "prompt pronto →
resposta em streaming" que todos os comandos de fase 2 precisam. Três
acoplamentos a quebrar com props novas: título fixo do comando, `AskForm`
importado direto (criaria ciclo — injete como render prop), e a ordem fixa
Copiar-antes-de-Colar.

Ícones já prontos em `assets/`: `cmd-ask-selection.png`,
`cmd-summarize-clipboard.png`, `cmd-skills.png`, `cmd-toolsets.png`. Faltam
`cmd-fix-clipboard.png`, `cmd-translate-clipboard.png`, `cmd-paste-answer.png`,
`cmd-jobs.png` — gere com `node tools-gerar-icones.mjs`, que reproduz a família
a partir dos SVGs originais do `@tabler/icons`.

`getSelectedText()` **rejeita** quando não há seleção; `Clipboard.readText()`
devolve `undefined` e não rejeita. São dois testes diferentes, nunca unifique.

### 2. Checklist manual dentro do Raycast

Seis defeitos que o reprovavam já foram corrigidos (itens 1, 7, 8, 9, 11 e 12),
mas **não foram reexercitados na interface**. Falta percorrer os 13 itens do fim
do `INSTRUCOES_DO_PROJETO.md` com a extensão rodando. O item 13 (navegação só
por teclado) nunca foi testado.

### 3. Divergências entre a spec e o código — corrigir a SPEC, não o código

- `docs/UX-SPEC.md:520-524` e `:534-541`: os literais do diagnóstico estão
  desatualizados. O código diz `Suas conversas foram encontradas`
  (`src/check-connection.tsx:336`) e `resposta na hora` (`:141`, exigido pela
  proibição de jargão da própria spec em `:1407`).
- `docs/UX-SPEC.md:741`: `"Chave de acesso do Hermes"` → `"Chave do Hermes"`,
  que é o que o usuário vê.
- `docs/UX-SPEC.md` §5.3: registrar o título órfão `# Não foi possível
  perguntar` (`src/ask.tsx:504`).

### 4. Duas decisões de produto em aberto

- O Toast `Sua tarefa terminou.` + `Ver resultado` da §6.5 não existe.
  Implementar ou riscar da spec?
- A ação `Abrir o Hermes Desktop` de E1/E22 não existe (só existe `Abrir **no**
  Hermes Desktop`, que é deep link de conversa). Implementar ou remover da spec?

## DECISÕES JÁ TOMADAS — não reabra

- **Sem variantes `@dark` dos ícones.** O `DESIGN.md` do Hermes diz que o
  ladrilho branco do `BrandMark` é "o único literal sancionado" justamente por
  ser idêntico no claro e no escuro. Variante escura contrariaria a marca.
- **Emoji governa markdown, `Icon.*` governa componente.** `src/ask.tsx:488`
  extrai nome de ferramenta com `/^🔧 Usando ([^—]+)/u`. Trocar o prefixo por um
  `Icon` quebra a lista de Etapas em silêncio.
- **A paleta mora em `src/lib/status.ts`, com `import type`.** `@raycast/api`
  não tem runtime em `node_modules`; um `theme.ts` com import de VALOR de
  `Icon`/`Color` seria impossível de carregar sob `node --test`.
- **Cor do Hermes só em posição `Color.ColorLike`** (`tintColor`, `tag.color`,
  `TagList.Item.color`). `accessory.text.color`, `accessory.date.color` e
  `Metadata.Label.text.color` exigem o enum e não recebem cor nossa.

## AMBIENTE

- Hermes v0.20.4 com código-fonte completo em
  `C:\Users\SAM\AppData\Local\hermes\hermes-agent`. É melhor que a documentação
  pública; use como fonte de verdade.
- Gateway ao vivo em `http://127.0.0.1:8642`.
- A chave está em `C:\Users\SAM\AppData\Local\hermes\.env`, nome
  `API_SERVER_KEY`. Pode lê-la para variável de shell; **nunca** imprima,
  registre nem escreva o valor em lugar nenhum.
- Raycast Windows 2.0.3, Node 22.22.2 (o do Raycast), React 19.2.1.

Três armadilhas de rede já pagas: use `127.0.0.1` literal (a porta é só IPv4);
**nunca** envie header `Origin` (403 de corpo vazio antes da auth); ao descobrir
endpoint, valide com `GET /health` exigindo `platform === "hermes-agent"` (a
porta 8644 é outro adaptador e também responde `/health`).

## REGRAS INEGOCIÁVEIS

- TypeScript strict; sem `any` sem comentário justificando.
- Nunca registre, exiba nem comite o valor da `API_SERVER_KEY`.
- Cancele streams no unmount com `AbortController`. **Nenhum** caminho pode
  chamar o endpoint de parar a run no unmount: fechar a janela do Raycast não
  cancela a tarefa (D-02).
- Toda criação de sessão envia `source: "desktop"` (D-01), senão a conversa some
  da barra lateral do Hermes Desktop — que é a funcionalidade principal.
- Windows: nenhum modificador `cmd`, sem menu-bar, sem AppleScript.
- Ações destrutivas passam por `confirmAlert`.
- Use os 7 rótulos de `src/lib/status.ts`. Nunca invente sinônimo.
- Interface em português do Brasil, linguagem simples, sem jargão.
- Todo arquivo de tela novo precisa do cabeçalho
  `/* eslint-disable @raycast/prefer-title-case ... */`, senão `ray lint --fix`
  reescreve os títulos em pt-BR para Title Case do inglês.
- **Não declare nada pronto sem rodar e mostrar a saída literal dos cinco
  portões** listados em "Estado".

## MÉTODO

Use workflows com agentes em paralelo para tarefas independentes, sempre com
verificação adversarial dos achados, com viés para REFUTAR: achado cuja citação
arquivo:linha não sustenta a alegação é erro do revisor, e "corrigir" um achado
refutado piora o código.

**Verifique você mesmo a saída dos portões e as citações que embasam mudança de
código.** Em duas sessões seguidas isso pagou: uma vez um agente relatou sucesso
enquanto um `Bearer` recebia uma Promise não aguardada; na outra, o levantamento
citou um hex de memória que só coincidiu com o valor real depois de eu converter
o `oklch` na mão.
