# Publicar no GitHub — o que só você pode fazer

Este arquivo é operacional: são os passos que dependem de você (conta do GitHub, teclado, tela) e
que nenhuma automação daqui consegue executar. O que era arquivo já está no repositório: `LICENSE`,
`README.md` + `README.pt-BR.md`, `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, os templates de
issue/PR e o workflow de CI.

## O caminho curto: o assistente

Existe um script que faz tudo o que está abaixo, em 12 etapas, explicando cada passo e parando
antes de qualquer coisa irreversível. Está fora do repositório, na área de trabalho:

- `Desktop\publicar-hermes.cmd` — clique duplo, abre a janela e roda
- `Desktop\publicar-hermes.sh` — o mesmo, para rodar no Git Bash com
  `bash ~/Desktop/publicar-hermes.sh`

Ele instala o GitHub CLI se faltar, faz o login, renomeia o branch, revisa o que vai ser
publicado, cria o repositório, aplica os tópicos, envia o código, liga o relato privado de
vulnerabilidade e põe o selo do CI nos READMEs. Dá para sair no meio com Ctrl-C: rodando de novo,
ele retoma de onde parou.

O resto deste documento é o mesmo caminho à mão, para quando você quiser entender o que o script
fez — ou fazer sem ele.

## 1. Criar o repositório

Estamos em `master`, sem remote. O GitHub cria repositório novo com `main` por padrão. Escolha uma
das duas e siga até o fim — não misture.

**Opção A — renomear para `main` (recomendado):**

```bash
git branch -m master main
```

**Opção B — manter `master`:** crie o repositório e depois mude o *default branch* para `master`
em Settings → General → Default branch. O workflow de CI já roda nos dois nomes.

Depois, com o [`gh`](https://cli.github.com) autenticado:

```bash
gh repo create hermes-raycast --public --source . --remote origin --description "Raycast extension for Windows that talks to a local Hermes Agent"
```

Troque `hermes-raycast` se preferir outro nome. Só faça o `git push` depois do passo 3.

## 2. Tópicos do repositório

Settings → About (engrenagem no topo direito) → Topics:

```text
raycast  hermes-agent  ai  typescript  windows  macos
```

O `macos` entrou junto com o suporte às duas plataformas: o manifesto é
`"platforms": ["macOS", "Windows"]`. Se você preferir esperar a primeira validação num Mac
(`docs/CHECKLIST-MANUAL.md`, seção macOS) antes de atrair usuários de lá, deixe o tópico de fora por
enquanto — a descrição do repositório é que não pode mentir.

Pelo `gh`, se preferir:

```bash
gh repo edit --add-topic raycast --add-topic hermes-agent --add-topic ai --add-topic typescript --add-topic windows --add-topic macos
```

## 3. Conferir o que vai no commit inicial

O `.gitignore` cobre `node_modules/`, `dist/`, `*.log`, `.env`, `raycast-env.d.ts` e
`.superpowers/`. Antes do primeiro push, olhe a lista inteira uma vez:

```bash
git status --porcelain
```

O que precisa continuar **fora**: qualquer `.env`, `state.db`, chave do Hermes, caminho com nome de
usuário real em arquivo novo. A auditoria de 2026-08-21 não achou nenhum desses no que já estava
rastreado — a conferência aqui é sobre o que você adicionar agora.

## 4. Ligar o relato privado de vulnerabilidade

Settings → Code security → **Private vulnerability reporting** → Enable.

Sem isso, o `SECURITY.md` manda o leitor para uma aba que não existe. Com isso ligado, o GitHub
ainda coloca sozinho a opção "Report a security vulnerability" na tela de nova issue.

## 5. Badge de CI no README

Depois do primeiro push, com o repositório já criado, cole esta linha logo abaixo do título em
`README.md` e em `README.pt-BR.md`, trocando `SEU-USUARIO/SEU-REPO`:

```markdown
[![CI](https://github.com/SEU-USUARIO/SEU-REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/SEU-USUARIO/SEU-REPO/actions/workflows/ci.yml)
```

Não coloquei antes porque badge com slug errado é pior que badge nenhum: fica vermelho para sempre
e ninguém entende por quê.

### Se o CI falhar na primeira execução

O workflow roda em `windows-latest` com **Node 24 pinado** — isso não é preferência: os testes são
`.ts` executados pelo `node --test` com remoção nativa de tipos, e em Node mais antigo o erro é de
sintaxe, não de versão. Se algo quebrar, o candidato mais provável é o passo `Raycast build`, que
depende do CLI do Raycast rodar sem a interface. Se ele não funcionar no runner, tire só esse passo
do workflow e mantenha os outros seis — não desligue o CI inteiro.

## 6. O GIF da demonstração

30 a 45 segundos, na ordem:

1. Abrir o Raycast com o atalho (mostre o atalho acontecendo, não a janela já aberta).
2. **Perguntar ao Hermes** com uma pergunta curta e de resposta rápida.
3. A resposta chegando em streaming — é o momento que vende a extensão.
4. Abrir a **mesma conversa** no Hermes Desktop, provando que é o mesmo histórico.

**O cuidado que nenhum grep pega:** a última cena mostra o Hermes Desktop, e o Desktop tem a lista
lateral de conversas. Antes de gravar, confira o que está visível ali. Nome de cliente, assunto
pessoal, qualquer coisa real vaza para o GIF e para sempre — o arquivo fica no histórico do git
mesmo se você trocar depois. Se der, grave com um perfil limpo do Hermes.

Salve em `assets/demo.gif` e troque o comentário HTML do `README.md` (procure por
`Demo GIF goes here`) pela linha:

```markdown
![Demo](assets/demo.gif)
```

Faça o mesmo no `README.pt-BR.md`.

## 7. Screenshots

Mesmo cuidado com a tela: sem nome real, sem conteúdo de conversa de verdade. Três bastam —
**Perguntar ao Hermes** com resposta, **Conversas do Hermes** com a lista, e **Execuções do Hermes**
com uma aprovação pendente. Guarde em `assets/` com nomes descritivos (`screenshot-ask.png`, etc.).

Para a Raycast Store existem requisitos próprios de tamanho e quantidade — isso é outro fluxo, veja
abaixo.

## Fora deste fluxo: a Raycast Store

Publicar na loja é um processo separado do GitHub e tem um bloqueio conhecido: o `ray lint` emite
**14 avisos de Title Case**, todos porque os títulos são frases em português. Isso é decisão de
nomenclatura, a ser resolvida antes da submissão — e de propósito não foi misturada com o trabalho
de abrir o repositório. Está registrado no [ROADMAP.md](../ROADMAP.md).
