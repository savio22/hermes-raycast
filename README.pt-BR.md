# Hermes para Raycast (Windows)

[![CI](https://github.com/savio22/hermes-raycast/actions/workflows/ci.yml/badge.svg)](https://github.com/savio22/hermes-raycast/actions/workflows/ci.yml)

Converse com o **Hermes Agent** que já roda no seu computador — sem abrir outro
aplicativo, sem sair do que você estava fazendo. Um atalho, uma pergunta, a resposta
aparece ali mesmo.

> Esta é a versão em português deste documento. O [README.md](README.md) em inglês tem o mesmo
> conteúdo, para quem chega pelo GitHub. A interface da extensão é toda em português.

## A ideia principal: é a MESMA conversa do Hermes Desktop

Esta não é uma segunda caixa de chat que vive à parte. Tudo que você pergunta aqui é
gravado no mesmo lugar onde o Hermes Desktop guarda as conversas dele.

Na prática:

- Você pergunta algo pelo Raycast enquanto trabalha. Depois abre o Hermes Desktop e a
  conversa está lá, em **Recentes**, com a pergunta e a resposta completas.
- O contrário também vale: as conversas que você começou no Hermes Desktop aparecem em
  **Conversas do Hermes** e podem ser continuadas daqui.
- Qualquer conversa tem a ação **Abrir no Hermes Desktop**, que foca exatamente aquela
  conversa no aplicativo.

E a promessa que sustenta isso no dia a dia: **fechar a janela do Raycast não cancela
nada**. Se você fizer uma pergunta longa e a janela sumir, a tarefa continua rodando no
Hermes. Ela reaparece em **Execuções do Hermes**, com a resposta pronta. Só o botão
**Parar** cancela de verdade.

## Instalação e configuração (sem terminal)

1. Instale a extensão no Raycast.
2. Deixe o **Hermes** ligado neste computador (o Hermes API Server precisa estar no ar).
3. Abra o Raycast e execute qualquer comando do Hermes — por exemplo
   **Perguntar ao Hermes**.

Na primeira vez a extensão mostra a tela de boas-vindas — e ela já chega sabendo: procura o
Hermes deste computador, descobre a porta certa e diz na primeira linha o que encontrou
("Achei o Hermes 0.20.4 aqui, em 127.0.0.1:8642") ou que ele está desligado. Aí é um Enter em
**Detectar configuração automaticamente**: a extensão lê a chave de acesso local, testa a
conexão e guarda a chave em segurança. Acabou — você já pode perguntar.

Esse Enter é de propósito. A chave do Hermes é um segredo que está num arquivo seu, e a
extensão não lê arquivo seu procurando segredo sem você mandar. Descobrir a **porta** é
diferente e acontece sozinho, sempre.

Se a detecção automática não achar nada, use o comando **Configurar Hermes**. Ele explica,
em português e passo a passo, onde fica o arquivo de configuração do Hermes, abre a pasta
para você e permite colar a chave manualmente. O mesmo comando serve para consertar a
configuração depois — por exemplo se a chave do Hermes for trocada.

Para conferir se está tudo funcionando a qualquer momento, use
**Verificar conexão com Hermes**.

### Sobre a chave

A chave do Hermes é local: ela nunca sai do seu computador e nunca é enviada para nenhum
servidor externo. A extensão fala apenas com `127.0.0.1`, ou seja, com o Hermes que roda
na sua própria máquina. Nos detalhes técnicos e nas mensagens de erro a chave aparece
sempre censurada.

## Os comandos

| Comando | Para quê |
| --- | --- |
| **Perguntar ao Hermes** | Pergunta rápida com resposta na hora. Dá para continuar a conversa, ramificar, renomear, copiar e abrir no Hermes Desktop. |
| **Conversas do Hermes** | Lista, busca e continua suas conversas — inclusive as que nasceram no Hermes Desktop. Permite renomear, fixar e arquivar. |
| **Executar tarefa no Hermes** | Para pedidos mais longos: mostra cada etapa até o resultado final, com aprovações quando o Hermes pede permissão. |
| **Execuções do Hermes** | O painel do que está em andamento: acompanhar, responder aprovações, parar, e reabrir resultados recentes. |
| **Modelos do Hermes** | Vê os modelos disponíveis no seu Hermes e escolhe qual a extensão usa por padrão. |
| **Skills do Hermes** | Mostra quais skills estão habilitadas no seu Hermes e o que cada uma faz. |
| **Ferramentas do Hermes** | Mostra os grupos de ferramentas do seu Hermes e quais estão prontos para usar. |
| **Automações do Hermes** | Acompanha as automações do Hermes; pausa, retoma ou roda uma delas na hora. |
| **Perguntar sobre seleção** | Pergunta sobre o texto que você selecionou ou copiou, sem sair do que estava fazendo. |
| **Resumir clipboard** | Resume em tópicos o texto que você acabou de copiar. |
| **Corrigir texto do clipboard** | Corrige ortografia, gramática e pontuação do texto copiado, sem comentários. |
| **Traduzir clipboard** | Traduz o texto copiado entre português e inglês, ou para o idioma que você pedir. |
| **Colar última resposta** | Cola a resposta mais recente do Hermes no aplicativo em que você está. |
| **Verificar conexão com Hermes** | Diagnóstico: o Hermes está ligado? A chave funciona? Qual endereço está sendo usado? |
| **Configurar Hermes** | Conectar ou reconectar a extensão ao Hermes, com detecção automática ou configuração manual. |

Tudo é acessível pelo teclado. Nenhuma ação existe apenas como atalho: `Ctrl+K` abre a
lista completa de ações de cada tela.

### Atualização da lista de conversas

Enquanto **Conversas do Hermes** está aberta, o polling de 4 segundos revalida somente a
primeira página. As páginas antigas que você já carregou permanecem na lista; use a ação
**Atualizar lista** (ou uma atualização manual) para revalidar também essa parte do histórico.

## Limitações conhecidas

Vale ser honesto sobre o que está fora desta versão:

- **Automações, habilidades e conjuntos de ferramentas já têm telas.** A disponibilidade
  depende do que o Hermes expõe: uma resposta HTTP `501` deixa Automações como indisponível,
  sem esconder o comando nem fingir que a lista está vazia.
- **`jobs_admin` está desligado neste servidor Hermes** (`GET /v1/capabilities` responde
  `"jobs_admin": false`, verificado na versão 0.20.4). Isso não esconde a tela: o comando
  consulta a rota real e mostra a indisponibilidade somente quando o servidor responde `501`.
- **Ramificar uma conversa não sincroniza como o resto.** Ao usar **Ramificar**, o Hermes
  cria a conversa filha com origem `api_server`, e ela **não aparece na lista principal do
  Hermes Desktop** (a conversa original continua aparecendo normalmente). A extensão avisa
  isso na hora.
- **O modelo padrão escolhido em Modelos do Hermes vale só para a extensão.** O Hermes
  Desktop continua com o modelo dele.
- **Quem configura os provedores de modelo é o Hermes Desktop.** Se nenhum provedor estiver
  autenticado, a extensão explica o problema mas não resolve por você.
- **Só Windows, só Hermes local.** A extensão fala exclusivamente com `127.0.0.1` e não tem
  modo remoto.
- **Ações dependentes do Hermes real ainda precisam de validação manual em cada máquina.**
  Os testes automatizados cobrem contratos, segurança, fila, persistência e parsing; o
  checklist de teclado e os cenários de streaming/aprovação continuam em
  `docs/CHECKLIST-MANUAL.md`.
- **Voz, memória de longo prazo e recursos de sessão** expostos pelo Hermes não têm
  interface aqui.
- **A extensão ainda não está publicada na Raycast Store.** Até lá, a instalação depende de
  alguém rodar a etapa de desenvolvedor abaixo uma vez nesta máquina.

Se algo der errado, a extensão sempre mostra uma mensagem em português explicando o que
aconteceu e o que fazer, com **Copiar detalhes técnicos** para quando você precisar pedir
ajuda.

## Para desenvolvedores

Requisitos: Node.js 24+ e o Raycast para Windows instalados. O Node 24 não é preferência: os
testes são `.ts` rodados pelo `node --test` com remoção nativa de tipos, e versões anteriores
falham com um erro de sintaxe que não parece erro de versão.

```bash
npm install       # instala as dependências
npm run dev       # desenvolve usando o alvo release do Raycast para Windows
npm run build     # compila os 15 pontos de entrada
npm run lint      # ESLint + Prettier + validação do manifesto
```

Testes (Node.js nativo, sem framework externo — os tipos são removidos pelo próprio Node):

```bash
node --test "tests/**/*.test.ts"
```

O conjunto atual tem 291 testes determinísticos. A checagem de tipos é feita com
`npm run typecheck`; o build e o lint são portões separados da publicação.

Verificação de tipos:

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tests/tsconfig.json
```

### Organização

- `src/lib/` — as regras: descoberta do servidor (`discovery`), cliente HTTP e rotas
  (`hermes-api`), leitura de eventos SSE (`hermes-events`), catálogo de erros (`errors`),
  rótulos de estado (`status`), preferências (`preferences`), armazenamento local
  (`storage`) e tipos (`types`).
- `src/hooks/` e `src/components/` — a lógica de acompanhamento de execuções e as telas
  compartilhadas (aprovações, progresso, primeiro uso).
- `src/<nome>.tsx` — um arquivo por comando declarado em `package.json`.
- `docs/` — os documentos que mandam no projeto, nesta ordem de prioridade:
  `DECISOES-VERIFICADAS.md` (decisões provadas contra o Hermes real) →
  `UX-SPEC.md` (telas, textos em pt-BR, atalhos) →
  `ARCHITECTURE.md` (contratos dos módulos, catálogo de erros, armadilhas) →
  `docs/research/` (a pesquisa da API que sustenta tudo).

Duas regras que não são detalhe: **nunca** use o modificador `cmd` em atalhos (no Windows
ele é ignorado silenciosamente) e **nunca** chame o endpoint de parada de uma execução na
limpeza de um `useEffect` — desmontar a tela cancela apenas o leitor local, e a tarefa
continua viva no Hermes.

## Contribuir

Relatos de bug e pull requests são bem-vindos. Comece pelo [CONTRIBUTING.md](CONTRIBUTING.md):
ele lista os portões que uma mudança precisa passar e as convenções que este código realmente
segue.

Problemas de segurança: [SECURITY.md](SECURITY.md). Para onde o projeto vai:
[ROADMAP.md](ROADMAP.md). O que mudou: [CHANGELOG.md](CHANGELOG.md).

## Licença

[MIT](LICENSE) © Savio Aglio (Chacal)
