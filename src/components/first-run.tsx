/*
 * `prefer-title-case` é uma regra de inglês. Todo texto visível desta extensão é
 * pt-BR literal da UX-SPEC, e §10.1 exige frase com maiúscula só na primeira palavra
 * ("Copiar detalhes técnicos", nunca "Copiar Detalhes Técnicos").
 */
/* eslint-disable @raycast/prefer-title-case */

/**
 * A superfície de PRIMEIRO USO (UX-SPEC §3), em um lugar só.
 *
 * Quatro telas empilháveis:
 *   FirstRunScreen    §3.4 — renderizada por QUALQUER comando quando não há chave.
 *                            `NotConfigured` é o mesmo componente com o nome que os
 *                            comandos usam na guarda de configuração.
 *   AutoDetectScreen  §3.5 — a ação explícita `Detectar configuração automaticamente`.
 *   ManualSetupScreen §3.7 — o caminho sem terminal, com Explorador + Bloco de Notas.
 *   WhyKeyScreen      §3.9 — `O que é isso?`.
 *
 * REGRAS DE SEGREDO QUE GOVERNAM ESTE ARQUIVO (UX-SPEC §3.1, §3.6 e §5.1 regra 5):
 * - a `API_SERVER_KEY` NUNCA entra em estado de React, em markdown, em Toast, em
 *   metadata, em log ou no clipboard — nem o valor, nem um prefixo, nem o tamanho;
 * - a única função que chega perto dela é `detectConfiguration()`, onde a chave vive
 *   como `const` local por duas linhas: vai para `saveDetectedApiKey()` (LocalStorage
 *   criptografado) e para `sanitizeTechnical()` como segredo A SER APAGADO;
 * - todo detalhe técnico exibido ou copiado passa por `sanitizeTechnical()`, sempre,
 *   inclusive quando não há chave carregada;
 * - a leitura de arquivo do Hermes só acontece sob ação do usuário. Nada aqui roda em
 *   background, em `interval` ou na inicialização de outro comando.
 *
 * `check-connection.tsx` (o diagnóstico da §2.7) importa daqui as telas e os auxiliares
 * de texto — antes eram duas implementações do mesmo §3, com literais já divergentes.
 */

import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Action, ActionPanel, Alert, Detail, Icon, Toast, confirmAlert, showToast, useNavigation } from "@raycast/api";
import { isHermesAgent, readApiKeyFromEnvFile, resolveBaseUrl, resolveHermesHome } from "../lib/discovery";
import {
  HermesAuthError,
  HermesConnectionError,
  HermesError,
  HermesWrongServerError,
  sanitizeTechnical,
  toHermesError,
} from "../lib/errors";
import { health, listModels } from "../lib/hermes-api";
import { forgetDetectedApiKey, saveDetectedApiKey } from "../lib/storage";
import { OpenPreferencesAction } from "./common";
import { SHORTCUTS } from "./shortcuts";

/* ───────────────────────── Textos literais da UX-SPEC ─────────────────────── */

export const E1_TEXT =
  "Não foi possível conectar ao Hermes. Verifique se o Hermes API Server está ativo e se a URL e a chave estão corretas.";
export const E2_TEXT = "O Hermes não aceitou a chave de acesso. Ela pode ter mudado desde a última vez.";
export const E3_TEXT =
  "Encontrei um programa nesse endereço, mas não é o Hermes API Server. Confira o endereço nas configurações.";
export const E26_TEXT = "Não consegui ler o arquivo de configuração do Hermes. Você pode configurar manualmente.";

/* ──────────────────────────── Utilidades pequenas ─────────────────────────── */

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** `19/08/2026 14:32:07` — formato literal do bloco de detalhes técnicos (§5.1). */
export function timestamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathReadable(target: string): Promise<boolean> {
  try {
    await access(target, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * §5.2 — a frase que o usuário lê vem do catálogo da UX-SPEC, escolhida pelo TIPO do
 * erro (nunca pela mensagem do servidor, que é redigida e muda entre versões).
 */
export function errorCopy(error: HermesError): { text: string; uxId?: string } {
  if (error instanceof HermesAuthError || error.uxId === "E2") return { text: E2_TEXT, uxId: "E2" };
  if (error instanceof HermesWrongServerError) return { text: E3_TEXT, uxId: "E3" };
  if (error instanceof HermesConnectionError || error.uxId === "E1") return { text: E1_TEXT, uxId: "E1" };
  return { text: error.userMessage, uxId: error.uxId };
}

export function technicalBlock(text: string): string {
  return ["### Detalhes técnicos", "", "```", text, "```"].join("\n");
}

/* ────────────────────────── Ações compartilhadas ──────────────────────────── */

export function AutoDetectAction({ title, onDone }: { title?: string; onDone?: () => void }) {
  const { push } = useNavigation();
  return (
    <Action
      title={title ?? "Detectar configuração automaticamente"}
      icon={Icon.MagnifyingGlass}
      shortcut={SHORTCUTS.autoDetect}
      onAction={() => push(<AutoDetectScreen onDone={onDone} />)}
    />
  );
}

export function ManualSetupAction() {
  const { push } = useNavigation();
  // Sem atalho de propósito (§3.4): `Ctrl+Shift+A` já significa `Abrir configurações`
  // em toda a extensão e um mesmo atalho não pode ter dois significados.
  return <Action title="Configurar manualmente" icon={Icon.Book} onAction={() => push(<ManualSetupScreen />)} />;
}

export function OpenHermesFolderAction({ hermesHome }: { hermesHome: string }) {
  return (
    <Action.Open
      title="Abrir a pasta do Hermes"
      target={hermesHome}
      icon={Icon.Folder}
      shortcut={SHORTCUTS.hermesFolder}
    />
  );
}

export function CopyTechnicalAction({ technical }: { technical: string }) {
  return (
    <Action.CopyToClipboard
      title="Copiar detalhes técnicos"
      // Já sanitizado na origem: nenhum Bearer, nenhuma chave, nem por acidente.
      content={technical === "" ? "Ainda não há detalhes técnicos: a verificação está em andamento." : technical}
      shortcut={SHORTCUTS.copyTechnical}
      icon={Icon.Clipboard}
    />
  );
}

export function ForgetKeyAction({ onDone }: { onDone?: () => void }) {
  return (
    <Action
      title="Esquecer a chave detectada"
      icon={Icon.Trash}
      style={Action.Style.Destructive}
      shortcut={SHORTCUTS.remove}
      onAction={async () => {
        const confirmed = await confirmAlert({
          title: "Esquecer a chave detectada?",
          message: "O Raycast vai apagar a chave guardada neste computador. Você pode detectar de novo quando quiser.",
          primaryAction: { title: "Esquecer a chave", style: Alert.ActionStyle.Destructive },
          dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
          rememberUserChoice: false,
        });
        if (!confirmed) return;
        await forgetDetectedApiKey();
        await showToast({ style: Toast.Style.Success, title: "Chave removida deste computador." });
        onDone?.();
      }}
    />
  );
}

export function BackAction() {
  const { pop } = useNavigation();
  // `Esc` já volta e é reservado pelo Raycast (§9.1): a ação existe para não ficar
  // órfã do painel, sem roubar o atalho.
  return <Action title="Voltar" icon={Icon.ArrowLeft} onAction={pop} />;
}

/* ─────────────────── Tela 2: primeiro uso, sem chave (§3.4) ───────────────── */

const FIRST_RUN_MARKDOWN = [
  "# Conecte o Raycast ao seu Hermes",
  "",
  "Para usar esta extensão, o Raycast precisa de uma chave de acesso do Hermes que está instalado neste computador. Isso é feito uma única vez.",
  "",
  '**O jeito mais fácil:** pressione Enter em "Detectar configuração automaticamente". O Raycast procura a chave no seu Hermes, testa a conexão e guarda a chave em segurança. A chave não é exibida em nenhum momento.',
  "",
  'Se preferir fazer manualmente, escolha "Configurar manualmente" no painel de ações.',
].join("\n");

/**
 * §3.4 — renderizada por QUALQUER comando quando não há chave (guarda de §2.2).
 * `navigationTitle` é o título do comando que o usuário abriu.
 */
export function FirstRunScreen({ navigationTitle, onDone }: { navigationTitle: string; onDone?: () => void }) {
  const { push } = useNavigation();
  return (
    <Detail
      navigationTitle={navigationTitle}
      markdown={FIRST_RUN_MARKDOWN}
      actions={
        <ActionPanel>
          <AutoDetectAction onDone={onDone} />
          <ManualSetupAction />
          <Action
            title="O que é isso?"
            icon={Icon.QuestionMarkCircle}
            shortcut={SHORTCUTS.showTechnical}
            onAction={() => push(<WhyKeyScreen />)}
          />
          <OpenPreferencesAction />
        </ActionPanel>
      }
    />
  );
}

export interface NotConfiguredProps {
  /** Título do comando que o usuário abriu — vira o `navigationTitle` (§3.4). */
  commandTitle: string;
  /** Reavalia a chave quando o usuário volta da detecção ou das configurações. */
  onRetry?: () => void;
}

/**
 * O mesmo `FirstRunScreen`, com o nome e a forma de props que os comandos usam na guarda
 * de configuração. Existe para que "sem chave" seja UMA tela na extensão inteira: antes
 * havia duas, e os literais da §3.4/§3.7 já tinham divergido entre elas.
 */
export function NotConfigured({ commandTitle, onRetry }: NotConfiguredProps): ReactElement {
  return <FirstRunScreen navigationTitle={commandTitle} onDone={onRetry} />;
}

/* ───────────────── Tela 3: detecção automática (§3.1, §3.5, §3.6) ─────────── */

type DetectionResult =
  | { kind: "sucesso"; hermesHome: string; baseUrl: string; version: string; technical: string }
  | { kind: "semArquivo"; hermesHome: string; folderExists: boolean; technical: string }
  | { kind: "semChave"; hermesHome: string; envPath: string; technical: string }
  | { kind: "semLeitura"; hermesHome: string; envPath: string; technical: string }
  | { kind: "recusada"; hermesHome: string; technical: string }
  | { kind: "offline"; hermesHome: string; text: string; technical: string };

/**
 * A ÚNICA função da extensão autorizada a tocar em arquivos do Hermes procurando um
 * segredo, e só a partir da ação explícita do usuário (§3.1). Limites, literalmente:
 *
 *   PERMITIDO: `<HERMES_HOME>\.env` só na linha `API_SERVER_KEY=` (por
 *   `readApiKeyFromEnvFile()`, que não devolve nenhuma outra variável);
 *   `<HERMES_HOME>\config.yaml` só para a porta e `<HERMES_HOME>\gateway.pid` só
 *   para saber se o gateway está vivo (os dois por `resolveBaseUrl()`).
 *
 *   PROIBIDO: qualquer outra chave do `.env`; `auth.json`, `state.db`, `desktop.json`,
 *   `connections.json`; escrever qualquer arquivo do Hermes; rodar em background;
 *   guardar a chave fora do LocalStorage; exibir a chave, seu prefixo ou seu tamanho;
 *   copiar a chave para o clipboard; repetir sozinha depois de falhar.
 */
async function detectConfiguration(): Promise<DetectionResult> {
  const hermesHome = await resolveHermesHome();
  const envPath = path.join(hermesHome, ".env");
  const folderExists = await pathExists(hermesHome);
  const envExists = folderExists && (await pathExists(envPath));

  const note = (extra: string): string =>
    sanitizeTechnical([`Pasta do Hermes: ${hermesHome}`, `Momento: ${timestamp()}`, extra].join("\n"));

  if (!folderExists || !envExists) {
    return {
      kind: "semArquivo",
      hermesHome,
      folderExists,
      technical: note(
        `Pasta existe: ${folderExists ? "sim" : "não"}. Arquivo .env existe: ${envExists ? "sim" : "não"}.`,
      ),
    };
  }

  // E26: o arquivo está lá mas não abre (permissão). Não é "chave ausente".
  if (!(await pathReadable(envPath))) {
    return {
      kind: "semLeitura",
      hermesHome,
      envPath,
      technical: note(`O arquivo ${envPath} existe, mas não pôde ser aberto para leitura.`),
    };
  }

  const key = await readApiKeyFromEnvFile(hermesHome);
  if (key === undefined) {
    return {
      kind: "semChave",
      hermesHome,
      envPath,
      technical: note("O arquivo .env foi lido, mas não tem uma linha API_SERVER_KEY= com valor."),
    };
  }

  // Único destino permitido do valor: o LocalStorage criptografado do Raycast.
  await saveDetectedApiKey(key);

  let baseUrl: string | undefined;
  try {
    const endpoint = await resolveBaseUrl({ force: true });
    baseUrl = endpoint.baseUrl;
    const info = await health();
    if (!isHermesAgent(info)) {
      throw new HermesWrongServerError({
        userMessage: E3_TEXT,
        technical: `GET ${endpoint.baseUrl}/health respondeu platform="${info.platform}", status="${info.status}".`,
        recovery: "open_preferences",
      });
    }
    await listModels();
    return {
      kind: "sucesso",
      hermesHome,
      baseUrl: endpoint.baseUrl,
      version: info.version,
      // `[key]` aqui é a segunda passada de redação: garante que nem um eco do valor
      // sobreviva no texto copiável.
      technical: sanitizeTechnical(
        [`Pasta do Hermes: ${hermesHome}`, `Endereço: ${endpoint.baseUrl}`, `Momento: ${timestamp()}`].join("\n"),
        [key],
      ),
    };
  } catch (err) {
    const error = toHermesError(err, "detecção automática");
    const technical = sanitizeTechnical(
      [
        `Pasta do Hermes: ${hermesHome}`,
        `Endereço: ${baseUrl ?? "não resolvido"}`,
        `Resposta: ${error.httpStatus ?? "-"}`,
        `Código: ${error.code ?? "-"}`,
        `Momento: ${timestamp()}`,
        "",
        error.technical,
      ].join("\n"),
      [key],
    );
    if (error instanceof HermesAuthError) {
      // §3.3: a chave detectada que o Hermes recusou não fica guardada.
      await forgetDetectedApiKey();
      return { kind: "recusada", hermesHome, technical };
    }
    return { kind: "offline", hermesHome, text: errorCopy(error).text, technical };
  }
}

function detectionMarkdown(result: DetectionResult): string {
  switch (result.kind) {
    case "sucesso":
      return [
        "# Pronto, está conectado",
        "",
        "Encontrei o Hermes deste computador e a conexão funcionou.",
        "",
        `- Endereço: ${hostOf(result.baseUrl)}`,
        `- Versão do Hermes: ${result.version}`,
        "- Chave de acesso: encontrada e guardada em segurança",
        "",
        "A chave ficou guardada no armazenamento protegido do Raycast e não é exibida em nenhuma tela.",
        "",
        "Suas conversas do Raycast vão aparecer também no Hermes Desktop.",
      ].join("\n");

    case "semArquivo":
      return [
        "# Não encontrei o Hermes neste computador",
        "",
        "Procurei em:",
        "",
        result.hermesHome,
        "",
        "e não achei o arquivo de configuração do Hermes.",
        "",
        "Isso costuma acontecer quando o Hermes está instalado em outra pasta ou ainda não foi instalado.",
      ].join("\n");

    case "semChave":
      return [
        "# Achei o Hermes, mas não achei a chave",
        "",
        "O arquivo de configuração existe, mas não tem a linha da chave de acesso.",
        "",
        `Arquivo: ${result.envPath}`,
        "Linha procurada: uma linha que começa com API_SERVER_KEY=",
        "",
        "Abra o Hermes Desktop uma vez e deixe o Hermes ligar. Ele cria essa chave sozinho na primeira execução.",
      ].join("\n");

    case "semLeitura":
      return ["# Não consegui abrir o arquivo do Hermes", "", E26_TEXT, "", `Arquivo: ${result.envPath}`].join("\n");

    case "recusada":
      return [
        "# A chave encontrada não foi aceita",
        "",
        "Encontrei uma chave no seu Hermes, mas o Hermes recusou essa chave.",
        "",
        "Normalmente isso significa que o Hermes está rodando com uma configuração diferente da que está salva em disco. Feche e abra o Hermes Desktop e tente de novo.",
      ].join("\n");

    case "offline":
      return ["# Não foi possível conectar", "", result.text].join("\n");
  }
}

/**
 * §3.5 — o resultado da detecção. A tela sempre diz o que foi lido e de onde, e nunca
 * mostra a chave. `Esquecer a chave detectada` desfaz tudo (§3.2, item 4).
 */
export function AutoDetectScreen({ onDone }: { onDone?: () => void }) {
  const { pop } = useNavigation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<DetectionResult | undefined>(undefined);
  const [showTechnical, setShowTechnical] = useState(false);

  const again = useCallback(() => {
    setResult(undefined);
    setShowTechnical(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    let toast: Toast | undefined;

    void (async () => {
      // §3.2: a ação nunca é silenciosa — o Toast animado é obrigatório.
      toast = await showToast({ style: Toast.Style.Animated, title: "Procurando a configuração do Hermes…" });
      const outcome = await detectConfiguration().catch((err: unknown) => {
        const error = toHermesError(err, "detecção automática");
        const failure: DetectionResult = {
          kind: "offline",
          hermesHome: "",
          text: errorCopy(error).text,
          technical: sanitizeTechnical(error.technical),
        };
        return failure;
      });
      if (!alive) {
        await toast.hide();
        return;
      }
      setResult(outcome);
      if (outcome.kind === "sucesso") {
        toast.style = Toast.Style.Success;
        toast.title = "Conectado ao Hermes";
      } else {
        await toast.hide();
      }
    })();

    return () => {
      alive = false;
      void toast?.hide();
    };
  }, [attempt]);

  if (result === undefined) {
    return (
      <Detail
        isLoading
        navigationTitle="Detectar configuração automaticamente"
        markdown={["# Detectar configuração automaticamente", "", "_Procurando a configuração do Hermes…_"].join("\n")}
        actions={
          <ActionPanel>
            <ManualSetupAction />
            <OpenPreferencesAction />
          </ActionPanel>
        }
      />
    );
  }

  const markdown = showTechnical
    ? [detectionMarkdown(result), "", technicalBlock(result.technical)].join("\n")
    : detectionMarkdown(result);

  const showFolder =
    result.hermesHome !== "" && (result.kind === "semChave" || (result.kind === "semArquivo" && result.folderExists));

  // A ordem muda com o desfecho, mas cada ação aparece UMA vez: `Tentar de novo` é a
  // primária quando repetir resolve (§3.5 B, C, D) e `Configurar manualmente` é a
  // primária quando repetir não vai resolver (§3.5 A e E26).
  const retryAction = (
    <Action
      key="tentar"
      title="Tentar de novo"
      icon={Icon.ArrowClockwise}
      shortcut={SHORTCUTS.refresh}
      onAction={again}
    />
  );
  const manualAction = <ManualSetupAction key="manual" />;
  const mainActions: ReactElement[] = [];

  if (result.kind === "sucesso") {
    mainActions.push(
      <Action
        key="continuar"
        title="Continuar"
        icon={Icon.CheckCircle}
        onAction={() => {
          pop();
          onDone?.();
        }}
      />,
      <Action
        key="testar"
        title="Testar de novo"
        icon={Icon.ArrowClockwise}
        shortcut={SHORTCUTS.testConnection}
        onAction={again}
      />,
    );
  } else if (result.kind === "semArquivo" || result.kind === "semLeitura") {
    mainActions.push(manualAction, retryAction);
  } else {
    mainActions.push(retryAction, manualAction);
  }

  if (showFolder) mainActions.push(<OpenHermesFolderAction key="pasta" hermesHome={result.hermesHome} />);
  if (result.kind === "semChave") {
    mainActions.push(
      <Action.CopyToClipboard
        key="caminho"
        title="Copiar o caminho do arquivo"
        content={result.envPath}
        shortcut={SHORTCUTS.copyPath}
        icon={Icon.Clipboard}
      />,
    );
  }
  mainActions.push(<OpenPreferencesAction key="preferencias" />);

  return (
    <Detail
      navigationTitle="Detectar configuração automaticamente"
      markdown={markdown}
      actions={
        <ActionPanel>
          <ActionPanel.Section>{mainActions}</ActionPanel.Section>
          <ActionPanel.Section title="Detalhes técnicos">
            <Action
              title={showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
              icon={showTechnical ? Icon.EyeDisabled : Icon.Eye}
              shortcut={SHORTCUTS.showTechnical}
              onAction={() => setShowTechnical((value) => !value)}
            />
            <CopyTechnicalAction technical={result.technical} />
          </ActionPanel.Section>
          {result.kind === "sucesso" ? (
            <ActionPanel.Section>
              <ForgetKeyAction onDone={again} />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    />
  );
}

/* ────────────────── Tela 4: caminho manual, sem terminal (§3.7) ───────────── */

function manualMarkdown(hermesHome: string): string {
  return [
    "# Configurar manualmente",
    "",
    "Você vai copiar uma linha de um arquivo de texto. Não precisa de terminal.",
    "",
    "**1. Abra a pasta do Hermes**",
    "",
    'Use a ação "Abrir a pasta do Hermes" aqui embaixo. O Explorador de Arquivos abre em:',
    "",
    hermesHome,
    "",
    "**2. Abra o arquivo chamado `.env`**",
    "",
    'Clique com o botão direito no arquivo `.env` e escolha "Abrir com" → "Bloco de Notas".',
    'Se o arquivo não aparecer, no Explorador vá em "Exibir" e marque "Itens ocultos".',
    "",
    "**3. Procure a linha que começa com `API_SERVER_KEY=`**",
    "",
    "No Bloco de Notas, pressione Ctrl+F, digite `API_SERVER_KEY` e pressione Enter.",
    "A linha se parece com isto:",
    "",
    "API_SERVER_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "",
    "**4. Copie só o que vem depois do sinal de igual**",
    "",
    "Selecione o texto depois do `=`, copie com Ctrl+C e feche o Bloco de Notas sem salvar.",
    "",
    "**5. Cole nas configurações da extensão**",
    "",
    'Use a ação "Abrir configurações" e cole no campo "Chave do Hermes".',
    "",
    "Guarde essa chave como uma senha: quem tiver ela consegue conversar com o seu Hermes.",
  ].join("\n");
}

/**
 * §3.7 — escrito para quem não vai abrir um terminal. `Abrir a pasta do Hermes` abre a
 * PASTA, nunca o arquivo: colocar o segredo na tela é escolha do usuário no Explorador,
 * não da extensão.
 */
export function ManualSetupScreen() {
  const [hermesHome, setHermesHome] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void resolveHermesHome().then((home) => {
      if (alive) setHermesHome(home);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Detail
      isLoading={hermesHome === undefined}
      navigationTitle="Configurar manualmente"
      markdown={manualMarkdown(hermesHome ?? "…")}
      actions={
        <ActionPanel>
          {hermesHome === undefined ? null : <OpenHermesFolderAction hermesHome={hermesHome} />}
          <OpenPreferencesAction />
          {hermesHome === undefined ? null : (
            <Action.CopyToClipboard
              title="Copiar o caminho do arquivo"
              // O CAMINHO, nunca o conteúdo do arquivo (§3.7).
              content={path.join(hermesHome, ".env")}
              shortcut={SHORTCUTS.copyPath}
              icon={Icon.Clipboard}
            />
          )}
          <AutoDetectAction title="Tentar detecção automática" />
          <BackAction />
        </ActionPanel>
      }
    />
  );
}

/* ─────────────────────── Tela 5: `O que é isso?` (§3.9) ───────────────────── */

const WHY_KEY_MARKDOWN = [
  "# Por que uma chave?",
  "",
  "O Hermes que roda no seu computador só aceita pedidos de programas que apresentem uma chave. Isso evita que qualquer site ou aplicativo aberto na sua máquina converse com o seu agente sem você saber.",
  "",
  'A chave fica só no seu computador. Ela nunca é enviada para a internet por esta extensão, nunca aparece em telas, mensagens de erro ou registros, e você pode removê-la a qualquer momento em "Esquecer a chave detectada".',
].join("\n");

export function WhyKeyScreen() {
  return (
    <Detail
      navigationTitle="Por que uma chave?"
      markdown={WHY_KEY_MARKDOWN}
      actions={
        <ActionPanel>
          <AutoDetectAction />
          <ManualSetupAction />
          <OpenPreferencesAction />
          <BackAction />
        </ActionPanel>
      }
    />
  );
}
