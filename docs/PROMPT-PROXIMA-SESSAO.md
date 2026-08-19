Continue o projeto da extensão Raycast para o Hermes Agent, que está em
C:\Users\SAM\Desktop\Projetos\Plugin RayCast

== LEIA PRIMEIRO, NESTA ORDEM (a de número menor vence em caso de conflito) ==

1. docs/DECISOES-VERIFICADAS.md   8 decisões PROVADAS contra o Hermes real.
                                  Este arquivo PREVALECE sobre todos os outros.
                                  Não reabra essas discussões.
2. docs/UX-SPEC.md                Spec tela a tela, textos literais em pt-BR,
                                  os 7 rótulos de estado, erros, aprovações.
3. docs/ARCHITECTURE.md           Contratos dos módulos, catálogo de erros,
                                  contrato de sincronia R1-R10, 55 armadilhas.
4. INSTRUCOES_DO_PROJETO.md       O brief de produto e as regras de engenharia.
5. docs/research/*.md             9.396 linhas de pesquisa verificada contra o
                                  código-fonte do Hermes, com citações
                                  arquivo:linha. Consulte para detalhe de campo.
6. docs/research/fixtures/CAPTURAS-AO-VIVO.md
                                  Transcrições literais dos streams SSE reais.

== ESTADO ATUAL (verificado rodando, não apenas relatado) ==

npx ray build                      exit 0, 7 pontos de entrada
npx tsc --noEmit (src e tests)     exit 0
node --test "tests/**/*.test.ts"   181 passando, 0 falhando

~11 mil linhas. src/lib com 8 módulos, src/components, src/hooks e 7 telas.
Comandos prontos: ask-hermes, sessions, run-task, active-runs, models,
check-connection, configure-hermes. Git limpo, 7 commits.

== AMBIENTE ==

- Hermes Agent v0.20.4 com CÓDIGO-FONTE COMPLETO em
  C:\Users\SAM\AppData\Local\hermes\hermes-agent
  Use como fonte de verdade. É melhor que a documentação pública.
- Gateway rodando ao vivo em http://127.0.0.1:8642
  GET /health responde sem auth; o resto exige Bearer.
- A chave está em C:\Users\SAM\AppData\Local\hermes\.env, nome API_SERVER_KEY.
  Você PODE lê-la para uma variável de shell e fazer requisições, mas NUNCA
  imprima, ecoe, registre nem escreva o valor em lugar nenhum.
- Raycast Windows 2.0.3, Node 22.22.2, React 19.2.1, @raycast/api ^1.104.20.

TRÊS ARMADILHAS DE REDE JÁ DESCOBERTAS (não redescubra do jeito difícil):
- Use 127.0.0.1 LITERAL, nunca "localhost" (a porta é só IPv4).
- NUNCA envie header Origin: o servidor devolve 403 de corpo vazio ANTES da auth.
- Ao descobrir um endpoint, valide com GET /health exigindo
  platform === "hermes-agent". A porta 8644 é outro adaptador e também
  responde /health.

== PRIMEIRA TAREFA: destravar o teste dentro do Raycast ==

Ao abrir um comando no Raycast apareceu:
   "Error: Missing executable. You might need to build the extension."

O comando APARECE na busca do Raycast, então o registro funcionou; falta o
bundle compilado. Já foi descoberto que `npx ray build` sozinho não emite
arquivo nenhum: é preciso `-o dist`. Foi criado o script `npm run build:dist`
e a pasta dist/ já tem os 7 comandos compilados.

Confirme com o usuário se o erro sumiu. Se persistir, investigue como o
Raycast para Windows localiza o executável de uma extensão em desenvolvimento:
- C:\Program Files\WindowsApps\Raycast.Raycast_2.0.3.0_x64__qypenmj9wpt2a\Raycast\backend\index.mjs
  (contém as funções de resolução de caminho de extensão)
- C:\Users\SAM\AppData\Local\Raycast\   (bancos de dados do app)
- C:\Users\SAM\.config\raycast\extensions\   (raiz das extensões)
O caminho canônico alternativo é manter `npx ray develop` rodando num terminal
aberto — em segundo plano o watcher morre.

== DEPOIS, NESTA ORDEM ==

1. Percorrer o checklist manual do fim do INSTRUCOES_DO_PROJETO.md com a
   extensão rodando de verdade no Raycast, corrigindo o que aparecer.
   Este é o critério de aceite que ainda NÃO foi cumprido.

2. Comandos de fase 2:
   - "Perguntar sobre seleção" — getSelectedText() está VERIFICADO como
     funcional no Windows (handler .NET nativo no Raycast.dll).
   - "Resumir clipboard", telas de Skills e de Ferramentas.
   - ATENÇÃO: o comando de Automações depende de
     capabilities.features.jobs_admin, que está FALSE neste servidor.
     A tela existiria só para dar erro. Resolva isso antes de construí-la.

3. Se o usuário autorizar, apagar 4 sessões de teste deixadas no Hermes:
   "Responder apenas ok", "Dizer apenas pronto",
   "Teste Raycast sincronia 180053", e a do run longo.

== REGRAS INEGOCIÁVEIS (do brief do usuário) ==

- TypeScript strict. Sem `any` sem comentário justificando.
- Nunca registre, exiba nem comite o valor da API_SERVER_KEY.
- Cancele streams no unmount com AbortController. NENHUM caminho pode chamar
  o endpoint de parar a run no unmount: fechar a janela do Raycast NÃO pode
  cancelar a tarefa (decisão D-02, provada experimentalmente).
- Toda criação de sessão envia source: "desktop" (decisão D-01). Sem isso a
  conversa some da barra lateral do Hermes Desktop, que é a funcionalidade
  principal do produto.
- Windows: nenhum modificador `cmd` em atalhos, sem menu-bar, sem AppleScript.
- Ações destrutivas passam por confirmAlert.
- Use os 7 rótulos de estado de src/lib/status.ts. Nunca invente sinônimo.
- Textos de interface em português do Brasil, linguagem simples, sem jargão.
- NÃO declare nada pronto sem rodar e mostrar a saída literal de:
    npx tsc --noEmit -p tsconfig.json
    node --test "tests/**/*.test.ts"
    npx ray build
    npx ray lint

== MÉTODO ==

Use workflows com agentes em paralelo para tarefas independentes, sempre com
uma fase de verificação adversarial dos achados, com viés para REFUTAR: achado
cuja citação arquivo:linha não sustenta a alegação é erro do revisor, e
"corrigir" um achado refutado piora o código. Verifique você mesmo a saída dos
portões em vez de confiar no relatório dos agentes — nesta sessão um agente
relatou sucesso enquanto um bug real (Bearer recebendo uma Promise não
aguardada) passava batido pelo compilador e pelos testes.
