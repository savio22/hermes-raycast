Continue a extensão Raycast do Hermes, em
C:\Users\<usuario>\Desktop\Projetos\Plugin RayCast

## O QUE JÁ ESTÁ PRONTO

**A conversa contínua está de pé, revisada e corrigida.** `Perguntar ao Hermes` é um `List`
só, com a barra de busca como campo de escrita, `Enter` enviando e uma linha por troca.

**A Fase 2 está implementada.** Os 15 comandos existem, estão no manifesto e compilam.

Estado dos portões, rodados em 2026-08-20 (não relatados — rodados):

```
npx tsc --noEmit -p tsconfig.json         exit 0
npx tsc --noEmit -p tests/tsconfig.json   exit 0
node --test "tests/**/*.test.ts"          267 passando, 0 falhando
npx ray lint                              0 erros (14 avisos de Title Case, esperados)
npx ray build --target release            exit 0, 15 entry points
```

### A revisão adversarial e a correção de interleavings

A revisão adversarial encontrou riscos de ciclo de vida; os dois cenários de interleaving
reproduzíveis receberam testes de regressão e foram corrigidos:

1. **`createRunOnce` podia usar a conversa que estivesse na tela depois de uma espera.** Ela roda sem
   `AbortSignal` de propósito (o `run_id` não pode nascer órfão), então sobrevivia a
   `switchSession` e reescrevia `runIdRef`/`sessionIdRef`/`lastSessionId` apontando a
   conversa antiga. A mensagem seguinte caía na conversa errada e `Parar` matava a tarefa
   errada. Corrigido: o destino é capturado antes do `await`, as escritas posteriores validam
   o contexto da conversa e `rememberRun` continua incondicional.
2. **Depois de qualquer falha ou de um `Parar`, toda mensagem nova nascia `Cancelado`.**
   `send` enfileirava sempre, e a recusa de "não disparar em cima de um erro" — que existe
   só para o que JÁ estava esperando — engolia também o que a pessoa acabou de escrever,
   com a explicação falsa "a resposta anterior não terminou". A conversa ficava sem saída.
   Corrigido: com a conversa parada, `send` marca `forcedRef`, que é o mesmo mecanismo do
   `Tentar novamente`. **A guarda é mais larga que `isTurnLive` de propósito** — inclui os
   turnos já em `startedRef` que ainda aparecem `queued` —, senão dois envios coladinhos
   virariam duas execuções na mesma conversa, que o servidor aceita e que custa 79 s (D-09).

Os achados históricos já resolvidos incluem: duração no lugar do rótulo em turno que falhou; turno expirado afirmando
"terminou sem escrever uma resposta"; duas réguas coladas no painel de erro sem texto;
`Carregar parte anterior` duplicada no mesmo `ActionPanel`; e o aviso da §8.6 que nunca
disparava ao trocar de conversa pelo seletor da barra.

O relatório completo, com os 20 refutados, está em
`%TEMP%\claude\...\scratchpad\achados.md` — se sumiu, o script é reexecutável:
`Workflow({ scriptPath: "...\\workflows\\scripts\\revisao-conversa-continua-wf_31d23490-09a.js" })`

## O QUE FALTA

### 1. O checklist manual — é o único item que sobrou, e precisa de alguém no teclado

`docs/CHECKLIST-MANUAL.md` está escrito e pronto. **A janela do Raycast não aparece em
captura de tela nesta máquina** (é desenhada pelo `Raycast.UIAccess.exe`): não há como
automatizar.

Suba com `npm run dev` e percorra os quatro pontos críticos primeiro — fluidez com a
conversa de 330 mensagens, a seleção brigando com as setas, a fila, e navegação só por
teclado. Depois os 13 cenários-base, os oito comandos de contexto e os extras.

**Se a interface engasgar, `RENDER_TURN_LIMIT` em `src/hooks/use-conversation.ts` é o
primeiro número a cair** (hoje 40), antes de qualquer outra mudança.

Os oito comandos que antes eram chamados de Fase 2 estão implementados. O que ainda precisa de
validação manual em cada instalação é `getSelectedText()` no Windows real (a maioria das janelas não entrega seleção ao
sistema — a queda para a área de transferência é o caminho normal, não a exceção), e o
tempo real de `/v1/toolsets` com o corte de 12 s.

### 2. Fase 3 — não especificada

Anexos e imagens; deeplinks `raycast://` para comandos da extensão; Tool para a IA do
Raycast; Hermes remoto; macOS. Nada disso tem tela desenhada.

## LEIA PRIMEIRO, NESTA ORDEM (a de número menor vence em conflito)

1. `docs/DECISOES-VERIFICADAS.md` — decisões provadas contra o Hermes real (D-01 a D-11).
2. `docs/superpowers/specs/2026-08-19-conversa-continua-design.md` — o desenho da tela.
3. `docs/UX-SPEC.md` — spec tela a tela. **Atualizada em 2026-08-20**: as §1.1, §1.2, §2.1,
   §2.2, §2.3, §6.1, §6.2, §6.4, §6.5, §9.2 e §9.3 foram reescritas.
4. `docs/ARCHITECTURE.md` — contratos dos módulos e armadilhas, incluindo as telas já
   implementadas de Skills, Ferramentas e Automações.
5. `INSTRUCOES_DO_PROJETO.md` — brief de produto e regras de engenharia.

## CONTRATOS DE CONTEXTO E ADMINISTRAÇÃO, CONFERIDOS AO VIVO EM 2026-08-20

- `GET /v1/skills` → 140 skills, exatamente `{name, description, category}`. **Duas vêm com
  `category` vazia** — a seção `Sem categoria` não é caso de borda teórico.
- `GET /api/jobs?include_disabled=true` → 1 automação, `state: "paused"`, `enabled: false`.
  **Sem o parâmetro ela some**, e a tela mentiria dizendo "nenhuma automação".
- `GET /v1/toolsets` → **não foi chamado nesta sessão de propósito.** O handler roda no laço
  de eventos do servidor e pode travar o Hermes inteiro por ~8 s
  (`hermes_cli/nous_account.py:595`). Cache de 10 min, corte em 12 s, nunca em segundo
  plano. Isso é o que o código faz; falta ver o tempo real com o Hermes carregado.
- `getSelectedText()` **rejeita** quando não há seleção; `Clipboard.readText()` devolve
  `undefined` e **não** rejeita. São dois testes diferentes, nunca unifique — unificar
  transforma "não há nada copiado" em "não consegui ler a seleção", que é mentira.

## DEPENDÊNCIAS DE FERRAMENTA

`tools-gerar-icones.mjs` precisa de `@tabler/icons` e `@resvg/resvg-js`, que **não estão no
`package.json`** (são ferramenta de build, não da extensão). Instale com
`npm install --no-save @tabler/icons @resvg/resvg-js` antes de rodar. O gerador é
determinístico: reexecutá-lo reproduz os ícones existentes byte a byte.

## A ARMADILHA DE BUILD — não redescubra

O CLI `@raycast/api` 1.104.x usa flavor `x` no Windows e grava em
`~/.config/raycast-x/extensions/hermes/`. O app Raycast 2.0.3 lê
`~/.config/raycast/extensions/<uuid || nome>/<comando>.js`. Era isso o
`Error: Missing executable`. O flag `--target release` corrige e já está nos scripts:
use `npm run dev`.

Para abrir um comando sem procurar na busca:
`powershell -c "Start-Process 'raycast://extensions/sam/hermes/ask-hermes'"`.

## AMBIENTE

- Hermes v0.20.4, com código-fonte completo em
  `C:\Users\<usuario>\AppData\Local\hermes\hermes-agent`. É melhor que a documentação pública.
- Gateway ao vivo em `http://127.0.0.1:8642`.
- A chave está em `C:\Users\<usuario>\AppData\Local\hermes\.env`, nome `API_SERVER_KEY`.
  Pode lê-la para variável de shell; **nunca** imprima, registre nem escreva o valor.
- Raycast Windows 2.0.3, Node 22.22.2 (o do Raycast), React 19.2.1.

Três armadilhas de rede já pagas: use `127.0.0.1` literal (a porta é só IPv4);
**nunca** envie header `Origin` (403 de corpo vazio antes da auth); ao descobrir endpoint,
valide com `GET /health` exigindo `platform === "hermes-agent"` (a porta 8644 é outro
adaptador e também responde `/health`).

## REGRAS INEGOCIÁVEIS

- TypeScript strict; sem `any` sem comentário justificando.
- Nunca registre, exiba nem comite o valor da `API_SERVER_KEY`.
- Cancele streams no unmount com `AbortController`. **Nenhum** caminho pode chamar o
  endpoint de parar a run no unmount: fechar a janela do Raycast não cancela a tarefa (D-02).
- Toda criação de sessão envia `source: "desktop"` (D-01).
- Conversa vazia é proibida: a conversa só nasce no primeiro envio.
- No máximo **um turno vivo por conversa** (R9). A trava é `pickTurnToRun()`.
- Windows: nenhum modificador `cmd`, sem menu-bar, sem AppleScript.
- Ações destrutivas passam por `confirmAlert`.
- Use os 7 rótulos de `src/lib/status.ts`. Nunca invente sinônimo. Automações têm
  vocabulário próprio (`JOB_STATE_LABEL`) e ferramentas também
  (`TOOLSET_AVAILABILITY_LABEL`) — os três não se misturam.
- Interface em português do Brasil, linguagem simples, sem jargão. A §10.2 da UX-SPEC
  **proíbe as palavras "chat", "thread" e "histórico"** em texto de tela — o termo é
  "conversa".
- Todo arquivo de tela novo precisa do cabeçalho
  `/* eslint-disable @raycast/prefer-title-case ... */`, senão `ray lint --fix` reescreve os
  títulos em pt-BR para Title Case do inglês. **Não rode `ray lint --fix` sem olhar o
  diff**: ele também mexe nos títulos de comando do `package.json`.
- **Não declare nada pronto sem rodar e mostrar a saída literal dos cinco portões.**

## MÉTODO

Escreva o teste antes do código nos módulos puros — foi assim que `turns.ts` nasceu, e foi o
que pegou os dois defeitos de fila antes de a tela existir.

Use workflows com agentes em paralelo para tarefas independentes, sempre com verificação
adversarial dos achados, com viés para REFUTAR. **E confira você mesmo cada citação
arquivo:linha antes de mexer no código.** Nesta sessão dois revisores diferentes chegaram a
conclusões opostas sobre o mesmo trecho — quem decidiu foi a leitura do código, não a
votação.
