# Changelog do Hermes

## [macOS e Windows] - {PR_MERGE_DATE}

- A extensão passa a ser declarada para os dois sistemas (`"platforms": ["macOS", "Windows"]`),
  com a mesma base de código. Nada do comportamento atual do Windows muda.
- O Hermes é encontrado sozinho em `~/.hermes` no macOS. A ordem da descoberta continua a
  mesma nos dois sistemas: `HERMES_HOME` → `gateway.pid.hermes_home` → pasta padrão do
  sistema. O suporte a `%LOCALAPPDATA%\hermes` no Windows segue intacto.
- A configuração manual passa a citar os programas do sistema em que você está — Finder e
  TextEdit no Mac, Explorador de Arquivos e Bloco de Notas no Windows —, e o mesmo vale para
  as teclas nos textos de tela (`Ctrl+C`/`Cmd+C`, `Ctrl+K`/`Cmd+K`, `Ctrl+Enter`/`Cmd+Enter`).
- Os atalhos customizados passam a declarar as teclas de cada sistema pela forma que a própria
  API do Raycast oferece (`{ Windows, macOS }`). No Windows continuam letra por letra o que
  eram; no macOS respeitam o `Cmd`. Onde existe equivalente semântico, `Keyboard.Shortcut.Common.*`
  continua sendo a primeira escolha.
- O escopo de memória (`sessionKey`) ganha um padrão por sistema. **Ninguém é migrado:** quem já
  usa no Windows continua em `raycast:windows:default`, e uma instalação nova de macOS começa em
  `raycast:macos:default`. O manifesto deixou de fixar um `default` justamente para que trocar
  esse valor no futuro não mude o escopo de quem nunca tocou no campo.
- Abrir uma conversa no Hermes Desktop ficou defensivo: se o esquema `hermes://` não estiver
  registrado, a extensão diz isso em vez de falhar em silêncio.
- **Validado à mão só no Windows 11.** Os testes automatizados cobrem os dois caminhos de
  código, mas a primeira passada num Mac — teclado, deep link e configuração manual — ainda
  precisa ser feita. O roteiro está em `docs/CHECKLIST-MANUAL.md`.

## [Correções de confiabilidade] - {PR_MERGE_DATE}

- Impede que uma troca de conversa durante a escolha do modelo desvie uma pergunta para o
  destino errado.
- Esconde `Continuar esta conversa` enquanto a execução ainda está ativa, evitando duas runs
  simultâneas no mesmo histórico.
- Persiste a fila local, reanexa execuções não terminais e mantém a retenção sem expulsar runs
  ativas.
- Entrega as telas de Skills, Ferramentas, Automações e os quatro comandos de clipboard com
  limites de entrada e proteção contra instruções copiadas.
- Testes, tipos e build de produção verificados. O checklist manual do Windows foi percorrido
  à mão, mais de uma vez, em Windows 11 com Raycast 2.0.3 e Hermes 0.20.4 — os cenários de
  streaming, aprovação e teclado que nenhum teste automatizado alcança.

## [Versão inicial] - {PR_MERGE_DATE}

Primeira versão pública da extensão do Hermes Agent para Raycast no Windows. (O suporte a
macOS chegou depois; veja a entrada [macOS e Windows] acima.)

### A ideia

As conversas do Raycast e as do Hermes Desktop são as mesmas conversas. O que você pergunta
aqui aparece lá, e o que começou lá pode ser continuado aqui. Fechar a janela do Raycast não
cancela nada: a tarefa continua rodando no Hermes e reaparece pronta em **Execuções do Hermes**.

### Primeiro uso

- A extensão descobre sozinha o endereço do Hermes instalado neste computador — porta do
  `config.yaml`, variável de ambiente, `.env` e, por último, a porta padrão — e confirma que
  respondeu o Hermes mesmo, não outro programa.
- A tela de boas-vindas já diz o que encontrou antes de você apertar Enter: a versão do Hermes
  e o endereço, ou que ele está desligado.
- A chave de acesso é lida do seu Hermes com **uma ação sua**, nunca em silêncio. Ela é testada
  antes de ser guardada, fica no armazenamento protegido do Raycast e não aparece em nenhuma
  tela, mensagem de erro ou detalhe técnico.
- Se preferir, **Configurar manualmente** explica passo a passo, sem terminal.

### Os comandos

Perguntar ao Hermes, Conversas do Hermes, Executar tarefa no Hermes, Execuções do Hermes,
Modelos do Hermes, Skills do Hermes, Ferramentas do Hermes, Automações do Hermes,
Perguntar sobre seleção, Resumir clipboard, Corrigir texto do clipboard, Traduzir clipboard,
Colar última resposta, Verificar conexão com Hermes e Configurar Hermes.

### Privacidade

A extensão fala apenas com `127.0.0.1` — o Hermes que roda na sua própria máquina. Nada é
enviado para servidores externos.
