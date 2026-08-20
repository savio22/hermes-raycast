Implemente a conversa contínua na extensão Raycast do Hermes, em
C:\Users\SAM\Desktop\Projetos\Plugin RayCast

## A TAREFA

Executar o desenho já aprovado em
`docs/superpowers/specs/2026-08-19-conversa-continua-design.md`.

Ele é a fonte da verdade desta tarefa: tem a tela, os textos literais em pt-BR, a
ordem do `ActionPanel`, os contratos dos três módulos novos, os testes e os riscos.
**Leia-o inteiro antes de escrever qualquer linha.** Não redesenhe, não reabra as
decisões — elas foram tomadas com o usuário e estão registradas na §3 do documento.

Em uma frase: `Perguntar ao Hermes` deixa de empilhar uma tela por turno e vira um
`List` só, com a barra de busca fazendo as vezes de campo de escrita, `Enter`
enviando por ser a ação primária, e uma linha por troca completa (sua mensagem no
título, a resposta no painel).

## LEIA PRIMEIRO, NESTA ORDEM (a de número menor vence em conflito)

1. `docs/DECISOES-VERIFICADAS.md` — decisões provadas contra o Hermes real.
2. `docs/superpowers/specs/2026-08-19-conversa-continua-design.md` — o desenho.
3. `docs/UX-SPEC.md` — spec tela a tela. **A §13 do desenho lista o que ela perde**;
   nessas seções o desenho vence, e a UX-SPEC é que deve ser corrigida no fim.
4. `docs/ARCHITECTURE.md` — contratos dos módulos e armadilhas.
5. `INSTRUCOES_DO_PROJETO.md` — brief de produto, regras de engenharia e o
   checklist manual de 13 itens.

## ESTADO (verificado rodando em 2026-08-19, não relatado)

```
npx tsc --noEmit -p tsconfig.json         exit 0
npx tsc --noEmit -p tests/tsconfig.json   exit 0
node --test "tests/**/*.test.ts"          182 passando, 0 falhando
npx ray lint                              exit 0   (1 aviso de Title Case, esperado)
npx ray build --target release            exit 0
```

A extensão roda de verdade dentro do Raycast: conecta, detecta a chave sozinha,
pergunta e responde. Nenhuma linha de `src/` foi alterada na sessão do desenho.

## A ARMADILHA DE BUILD — não redescubra

O CLI `@raycast/api` 1.104.x usa flavor `x` no Windows e grava em
`~/.config/raycast-x/extensions/hermes/`. O app Raycast 2.0.3 lê
`~/.config/raycast/extensions/<uuid || nome>/<comando>.js`. Era isso o
`Error: Missing executable` — o build sempre esteve certo, a pasta é que era a antiga.

O flag oculto `--target release` corrige e **já está nos scripts**. Use `npm run dev`
(que é `ray develop --target release`) e deixe rodando — é literalmente o que o botão
"Start Development" do Raycast executa.

## O QUE ESTA TAREFA CANCELA

O "Passo 0 obrigatório" das sessões anteriores — extrair `AnswerView` de `src/ask.tsx`
para `src/components/answer-view.tsx` — **está cancelado**. `AnswerView` deixa de
existir; quem precisar de "prompt pronto → resposta escrevendo" monta a
`ConversationView` com um turno inicial já enviado. Ver §9.2 do desenho.

## RESOLVA AO VIVO ANTES DE IMPLEMENTAR A PARTE QUE DEPENDE

Quatro perguntas do apêndice do desenho só se respondem com o Hermes rodando e a
extensão aberta. Meça cada uma **antes** da parte que depende dela, não depois:

1. **Fluidez do render** — 40 itens com painel, um escrevendo a ~12 atualizações por
   segundo, no Raycast Windows. Se travar, o teto de 40 turnos cai antes de qualquer
   outra coisa ser mexida (§4.6, §9.4, §15).
2. **Duas execuções na mesma conversa** — o Hermes aceita? O que acontece na
   intercalação? A regra R9 só existe em comentário. Isto decide se a fila da §7 basta.
3. **Aprovação em conversa com vários turnos** — `approval.request` chega igual numa
   segunda execução da mesma conversa? A fila de aprovação é por execução ou por
   conversa? O código de hoje assume por execução (`use-run-stream.ts:252`).
4. **Latência de `askInSession` em conversa longa** — quanto demora o primeiro pedaço
   de texto quando o agente precisa recarregar o passado. Decide se a conversa
   *parece* fluida.

A quinta pergunta histórica — se `Enter` quebra linha num `Form.TextArea` no Raycast
Windows — **continua sem resposta e deixou de bloquear**. O desenho não depende mais
dela; é por isso que a barra de busca virou o campo principal e o `Form` virou desvio.

## DEPOIS QUE A CONVERSA ESTIVER DE PÉ

1. **Corrigir a UX-SPEC** conforme a §13 do desenho — a spec segue o código aqui,
   porque a mudança foi deliberada.
2. **Percorrer o checklist manual de 13 itens** do fim do `INSTRUCOES_DO_PROJETO.md`
   com a extensão rodando. O item 13 (navegação só por teclado) nunca foi testado, e
   agora é o item mais importante dos treze.
3. **Fase 2 — os comandos que faltam.** Contratos já verificados ao vivo:
   - `GET /v1/skills` → `{object:"list", data:[{name, description, category}]}`.
     140 skills neste servidor; `category` pode ser `null`. Tipos já em `src/lib/types.ts`.
   - `GET /v1/toolsets` → **cuidado real**: o handler roda no laço de eventos do
     servidor e pode disparar uma leitura síncrona de 8 s ao portal da Nous
     (`hermes_cli/nous_account.py:595`), travando o Hermes inteiro. Cache de 10 min no
     cliente, corte em 12 s, nunca em segundo plano.
   - `GET /api/jobs?include_disabled=true` → o parâmetro é **obrigatório**: sem ele o
     servidor filtra jobs desabilitados, e esta máquina tem um pausado que sumiria.
   - Ícones prontos em `assets/`: `cmd-ask-selection.png`, `cmd-summarize-clipboard.png`,
     `cmd-skills.png`, `cmd-toolsets.png`. Faltam `cmd-fix-clipboard.png`,
     `cmd-translate-clipboard.png`, `cmd-paste-answer.png`, `cmd-jobs.png` — gere com
     `node tools-gerar-icones.mjs`.
   - `getSelectedText()` **rejeita** quando não há seleção; `Clipboard.readText()`
     devolve `undefined` e não rejeita. São dois testes diferentes, nunca unifique.

## DECISÕES JÁ TOMADAS — não reabra

- **Sem variantes `@dark` dos ícones.** O `DESIGN.md` do Hermes diz que o ladrilho
  branco do `BrandMark` é "o único literal sancionado" por ser idêntico no claro e no
  escuro.
- **Emoji governa markdown, `Icon.*` governa componente.** O parser extrai nome de
  ferramenta com `/^🔧 Usando ([^—]+)/u`; trocar o prefixo por um `Icon` quebra a lista
  de etapas em silêncio.
- **A paleta mora em `src/lib/status.ts`, com `import type`.** `@raycast/api` não tem
  runtime em `node_modules`; um `theme.ts` com import de VALOR seria impossível de
  carregar sob `node --test`.
- **Cor do Hermes só em posição `Color.ColorLike`** (`tintColor`, `tag.color`,
  `TagList.Item.color`). `accessory.text.color`, `accessory.date.color` e
  `Metadata.Label.text.color` exigem o enum e não recebem cor nossa.
- **O motor continua em `/v1/runs`**, não em `/api/sessions/{id}/chat/stream`: abortar
  aquele fetch cancela o turno no servidor, e a D-02 exige que fechar a janela deixe a
  tarefa viva.

## AMBIENTE

- Hermes v0.20.4 com código-fonte completo em
  `C:\Users\SAM\AppData\Local\hermes\hermes-agent`. É melhor que a documentação
  pública; use como fonte de verdade.
- Gateway ao vivo em `http://127.0.0.1:8642`.
- A chave está em `C:\Users\SAM\AppData\Local\hermes\.env`, nome `API_SERVER_KEY`.
  Pode lê-la para variável de shell; **nunca** imprima, registre nem escreva o valor
  em lugar nenhum.
- Raycast Windows 2.0.3, Node 22.22.2 (o do Raycast), React 19.2.1.

Três armadilhas de rede já pagas: use `127.0.0.1` literal (a porta é só IPv4);
**nunca** envie header `Origin` (403 de corpo vazio antes da auth); ao descobrir
endpoint, valide com `GET /health` exigindo `platform === "hermes-agent"` (a porta
8644 é outro adaptador e também responde `/health`).

## REGRAS INEGOCIÁVEIS

- TypeScript strict; sem `any` sem comentário justificando.
- Nunca registre, exiba nem comite o valor da `API_SERVER_KEY`.
- Cancele streams no unmount com `AbortController`. **Nenhum** caminho pode chamar o
  endpoint de parar a run no unmount: fechar a janela do Raycast não cancela a
  tarefa (D-02).
- Toda criação de sessão envia `source: "desktop"` (D-01), senão a conversa some da
  barra lateral do Hermes Desktop — que é a funcionalidade principal.
- Conversa vazia é proibida: a conversa só nasce no primeiro envio.
- No máximo **um turno vivo por conversa** (R9). Não há trava no servidor; a fila da
  §7 do desenho é a trava.
- Windows: nenhum modificador `cmd`, sem menu-bar, sem AppleScript.
- Ações destrutivas passam por `confirmAlert`.
- Use os 7 rótulos de `src/lib/status.ts`. Nunca invente sinônimo.
- Interface em português do Brasil, linguagem simples, sem jargão. A §10.2 da UX-SPEC
  **proíbe as palavras "chat", "thread" e "histórico"** em texto de tela — o termo é
  "conversa".
- Todo arquivo de tela novo precisa do cabeçalho
  `/* eslint-disable @raycast/prefer-title-case ... */`, senão `ray lint --fix`
  reescreve os títulos em pt-BR para Title Case do inglês.
- **Não declare nada pronto sem rodar e mostrar a saída literal dos cinco portões**
  listados em "Estado".

## MÉTODO

Use workflows com agentes em paralelo para tarefas independentes, sempre com
verificação adversarial dos achados, com viés para REFUTAR: achado cuja citação
arquivo:linha não sustenta a alegação é erro do revisor, e "corrigir" um achado
refutado piora o código.

**Verifique você mesmo a saída dos portões e as citações que embasam mudança de
código.** Em três sessões seguidas isso pagou: um agente relatou sucesso enquanto um
`Bearer` recebia uma Promise não aguardada; um levantamento citou um hex de memória
que só coincidiu depois de converter o `oklch` na mão; e um refutador declarou
inexistente um arquivo do Hermes porque procurou no repositório errado.
