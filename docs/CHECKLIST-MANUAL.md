# Checklist manual — a conversa contínua

**Para quem está no teclado.** Este é o único item que não dá para automatizar: a janela do Raycast
é desenhada pelo `Raycast.UIAccess.exe` e **não aparece em captura de tela** nesta máquina.

Antes de marcar qualquer cenário de integração, inicie o Hermes e confirme que ele responde
`platform: "hermes-agent"` em `http://127.0.0.1:8642` (ou registre a porta descoberta). A
checagem automatizada não substitui essa validação manual.

Para abrir o comando direto, sem procurar na busca:

```bash
powershell -c "Start-Process 'raycast://extensions/sam/hermes/ask-hermes'"
```

---

## Os quatro pontos críticos — faça estes primeiro

Nunca foram exercitados e são os mais prováveis de precisar de ajuste.

### C1. Fluidez com conversa longa

1. Abra `Conversas do Hermes` e entre na conversa `20260818_173215_4af30a` (330 mensagens) com
   `Enter` (`Continuar esta conversa`).
2. Mande uma pergunta curta e **olhe a lista enquanto ela responde**.

**O que observar:** a lista inteira repinta a cada atualização de texto, porque `isShowingDetail`
está ligado. O texto deve crescer em passos visíveis (~12 por segundo), sem engasgo, sem a seleção
piscando e sem atraso ao apertar as setas.

**Se engasgar:** baixe `RENDER_TURN_LIMIT` em `src/hooks/use-conversation.ts` (hoje `40`). É uma
constante só, e é ela que cai **antes** de qualquer outra coisa ser mexida. Tente `20`, depois `12`.

- [ ] passou sem engasgo
- [ ] engasgou — `RENDER_TURN_LIMIT` baixado para: ______

### C2. A seleção brigando com as setas

1. Mande uma pergunta.
2. **Enquanto ela responde**, aperte ↑ e ↓ várias vezes.

**O esperado:** a seleção estaciona no turno novo enquanto ele responde e é **solta** quando ele
termina; daí em diante as setas navegam livres.

**O defeito a procurar:** a seleção pular de volta sozinha, ou as setas não responderem. Se
acontecer, o problema é o `selectedItemId` (raycast/extensions#10844), não o seu teclado.

- [ ] a seleção estaciona durante a resposta
- [ ] as setas navegam livres depois que o turno termina

### C3. A fila

1. Mande uma pergunta.
2. **Sem esperar**, escreva outra e aperte `Enter`.

**O esperado:** a segunda aparece na hora como turno novo, no fim da lista, com o rótulo
`Preparando`, e a barra é limpa. Quando a primeira termina, a segunda **dispara sozinha**.

Depois, o caminho triste:

3. Mande uma pergunta, enfileire outra, e **pare** a primeira (`Ctrl+Shift+P`).
4. A enfileirada **não** pode disparar. Ela fica com o rótulo `Cancelado` e a linha
   `Esta mensagem não chegou a ser enviada porque a resposta anterior não terminou.`, com
   `Tentar novamente` disponível.

E a remoção:

5. Enfileire uma e use `Remover da fila` (`Ctrl+D`) — some sem confirmação.
6. Enfileire outra e use `Editar antes de enviar` — o texto volta para a barra.

- [ ] a segunda entra como `Preparando` e dispara sozinha
- [ ] parar a primeira **não** dispara a fila
- [ ] `Remover da fila` e `Editar antes de enviar` funcionam

### C4. Navegação só por teclado (item 13 do checklist do projeto)

Sem tocar no mouse, em nenhum momento:

- [ ] abrir os 15 comandos do manifesto, chegar ao resultado e voltar
- [ ] em cada tela, `Ctrl+K` lista **todas** as ações daquele contexto
- [ ] nenhuma ação existe só como atalho, sem entrada no painel
- [ ] no `Escrever mensagem longa`: `Tab` percorre os campos, `Ctrl+Enter` envia, `Esc` volta
- [ ] no `confirmAlert` de excluir conversa: `Enter` aciona a primária, `Esc` cancela
- [ ] o Toast com ação (`Esta conversa já está no Hermes Desktop`) responde ao atalho sem tirar o
      foco da lista

---

## Os 13 itens do checklist do projeto

- [ ] **1. primeiro uso sem configuração** — apague a chave nas preferências da extensão e abra
      `Perguntar ao Hermes`. Tem que cair na tela `Conecte o Raycast ao seu Hermes`, nunca num erro
      de rede.
- [ ] **2. conexão válida** — `Verificar conexão com Hermes` mostra `Tudo certo`.
- [ ] **3. chave inválida** — troque a chave por lixo. O erro é E2, e a **primeira** ação tem que ser
      `Detectar configuração automaticamente`, não `Tentar novamente`.
- [ ] **4. Hermes desligado** — pare o Hermes e pergunte. E1, com a frase exata
      `Não foi possível conectar ao Hermes. Verifique se o Hermes API Server está ativo e se a URL e a chave estão corretas.`
- [ ] **5. pergunta curta** — conversa nova, uma pergunta, resposta completa. Confira que ela
      aparece em Recentes no Hermes Desktop.
- [ ] **6. resposta em streaming** — o texto cresce em passos; `_Preparando…_` vira
      `_O Hermes está pensando…_` depois de 3 s. Em conversa longa isso leva ~5,5 s e é normal.
- [ ] **7. interrupção de run** — `Parar` (`Ctrl+Shift+P`) durante a resposta. O aviso
      `Pedido de parada enviado…` aparece, o estado vira `Interrompendo` e depois `Cancelado`, e o
      texto parcial **fica**.
- [ ] **8. pedido de aprovação** — peça algo que exija comando no computador. O turno mostra o bloco
      🔐 e a ação `Responder pedido de aprovação`. Aprove uma vez e negue outra.
- [ ] **9. lista vazia** — sem conversa nenhuma, `Perguntar ao Hermes` abre em `Comece a conversa` e
      **`Enter` na barra vazia mostra `Escreva sua pergunta.`, sem enviar nada**.
- [ ] **10. sessão com muitas mensagens** — é o C1 acima. Confira também
      `Carregar parte anterior da conversa` (`Ctrl+Shift+H`) e o item do topo com o subtítulo
      `Traz as 40 trocas anteriores a estas.`
- [ ] **11. erro de rede durante streaming** — pare o Hermes **no meio** de uma resposta. O texto já
      recebido fica; o bloco de erro entra abaixo; `Acompanhar de novo` (`Ctrl+R`) aparece se der
      para reassinar.
- [ ] **12. cópia e colagem de resposta** — `Ctrl+Shift+C` (HUD `Resposta copiada`) e
      `Ctrl+Shift+V` em outro aplicativo (HUD `Resposta colada`).
- [ ] **13. navegação completa somente por teclado** — é o C4 acima.

---

## Extras desta tela que valem um olhar

- [ ] **Fechar a janela no meio da resposta e reabrir.** A tarefa **continua rodando** (D-02). Ao
      voltar, o turno é reanexado à mesma execução (sem novo envio), o resultado final chega e
      qualquer mensagem ainda enfileirada reaparece na conversa certa.
- [ ] **Trocar durante escolha de modelo e durante stream.** O resultado da conversa antiga não
      pode aparecer na nova; a pergunta continua pertencendo à conversa original e a tarefa
      antiga continua em `Execuções do Hermes`.
- [ ] **Continuar durante tarefa ativa.** Enquanto uma execução estiver `Preparando`, `Executando`,
      `Aguardando aprovação` ou `Interrompendo`, a ação `Continuar esta conversa` não aparece.
      Ela só volta depois de `Concluído`, `Cancelado`, `Falhou` ou `Execução expirada`.
- [ ] **Parar e enviar de novo imediatamente.** A nova pergunta permanece na fila e não recebe
      `Cancelado` junto com itens bloqueados pelo cancelamento anterior.
- [ ] **Retenção terminal.** Criar mais de 20 execuções concluídas e confirmar que uma execução
      ativa continua visível na lista.
- [ ] **Automações sem autorização.** Provocar HTTP 401 e confirmar a tela de primeiro uso com
      ação de detecção/configuração; HTTP 501 continua explicando indisponibilidade.
- [ ] **Clipboard hostil.** Testar emoji, texto misto, 20.000+ caracteres e instruções maliciosas;
      o prompt delimita o conteúdo, preserva início/fim e comunica o corte.
- [ ] **Trocar de conversa pelo seletor da barra com uma mensagem na fila.** Tem que aparecer o
      `confirmAlert` `Descartar as mensagens que ainda não foram enviadas?`. Recusando, o seletor
      precisa **voltar a exibir a conversa real** — se ele ficar mostrando a conversa que você não
      abriu, é defeito.
- [ ] **O rascunho da barra sobrevive à troca de conversa.** Escreva sem enviar, troque de conversa:
      o texto continua lá.
- [ ] **`Ctrl+T`** alterna Resposta/Etapas e as etapas mostram as linhas com emoji.
- [ ] **`Ctrl+Shift+D`** abre `Ver mensagens e ferramentas` a partir da conversa e da lista — e
      **nunca** aparece junto de `Detectar configuração automaticamente` no mesmo painel.
- [ ] **`Modelos do Hermes`** → `Usar só na próxima pergunta` (`Ctrl+Shift+M`). Volte para a
      conversa, pergunte, e confira o campo `Modelo` do painel. A pergunta seguinte volta ao padrão.

---

## Primeiro uso — a sondagem de presença (§3.4)

A tela de boas-vindas agora diz o que encontrou **antes** de você apertar Enter. Para exercitar os
dois desfechos é preciso apagar a chave guardada: `Configurar Hermes` →
`Esquecer a chave detectada` (`Ctrl+D`), e o campo `Chave do Hermes` das configurações precisa
estar **vazio** — se ele tiver algo, a preferência vence (§3.3) e a tela nem aparece.

- [ ] **Hermes ligado.** Abra `Perguntar ao Hermes`. A tela mostra por um instante
      `Procurando o Hermes neste computador…` e então
      `Achei o Hermes 0.20.4 aqui, em 127.0.0.1:8642. Falta só a chave de acesso.`
      `Enter` conecta e `Continuar` volta para a pergunta.
- [ ] **Hermes desligado.** Pare o Hermes e reabra o comando. A linha vira
      `O Hermes não respondeu neste computador. Ligue o Hermes antes de continuar…` — **antes** de
      qualquer Enter. É o ponto todo da mudança: o usuário descobre agora, não depois da detecção
      falhar e descartar a chave que ela tinha achado.
- [ ] **Endereço errado.** Preencha `Endereço do Hermes` com `127.0.0.1:8644` (o adaptador de
      webhook). A linha vira `Tem um programa respondendo nesse endereço, mas não é o Hermes.`
      Limpe o campo depois.

## Primeiro uso — chave recusada (E2, §5.2)

- [ ] Com a extensão já conectada, troque a `API_SERVER_KEY` do Hermes e reinicie o Hermes. Abra
      `Conversas do Hermes`: a tela de erro E2 tem `Detectar configuração automaticamente` como
      **primeira** ação, e ela resolve sem passar por `Tentar novamente`.
- [ ] Nessa mesma tela, confira que **não** existe `Ver mensagens e ferramentas` no painel — as
      duas dividem `Ctrl+Shift+D` e nunca podem coexistir (`components/shortcuts.ts`).

## Publicação — as capturas de tela

A Store exige capturas em `metadata/`, e **elas não podem ser geradas por automação nesta máquina**:
a janela do Raycast é desenhada pelo `Raycast.UIAccess.exe` e sai em branco em qualquer captura
feita por script. Precisa ser você, com a ferramenta de captura do Windows.

Formato: **PNG, 2000×1250** (proporção 16:10), nomeadas `hermes-1.png` … `hermes-6.png`, na pasta
`metadata/` na raiz do projeto.

- [ ] `hermes-1.png` — `Perguntar ao Hermes` com uma resposta pronta na tela.
- [ ] `hermes-2.png` — `Conversas do Hermes`, lista com várias conversas e o detalhe aberto.
- [ ] `hermes-3.png` — `Executar tarefa no Hermes` mostrando as etapas em andamento.
- [ ] `hermes-4.png` — `Execuções do Hermes` com pelo menos uma execução ativa.
- [ ] `hermes-5.png` — a tela de boas-vindas com a linha `Achei o Hermes … aqui`.
- [ ] `hermes-6.png` — `Modelos do Hermes` ou `Automações do Hermes`.

Antes de publicar, confira também que `author` no `package.json` é o **seu nome de usuário do
Raycast** — hoje está `sam`. Se não bater com a conta, a publicação é recusada.

---

## Como reportar

Para cada item que falhar, anote: o que você fez, o que apareceu, e o que esperava. Não é preciso
diagnosticar — a citação do que apareceu na tela basta.
