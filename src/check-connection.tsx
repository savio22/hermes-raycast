/**
 * `Verificar conexão com Hermes` (UX-SPEC §2.7) — o diagnóstico em cinco passos.
 *
 * A superfície de PRIMEIRO USO (§3) — `FirstRunScreen`/`NotConfigured`, `AutoDetectScreen`,
 * `ManualSetupScreen`, `WhyKeyScreen` e as ações de configuração — mora em
 * `components/first-run.tsx`, porque os outros quatro comandos renderizam a mesma tela na
 * guarda de configuração. Aqui fica só o que é diagnóstico.
 *
 * REGRA DE SEGREDO QUE GOVERNA ESTE ARQUIVO (UX-SPEC §2.7, §5.1 regra 5): a
 * `API_SERVER_KEY` nunca entra em estado de React, markdown, Toast, metadata, log ou
 * clipboard — nem o valor, nem um prefixo, nem o tamanho. Só a ORIGEM da chave é lida, e
 * todo detalhe técnico exibido ou copiado passa por `sanitizeTechnical()`, sempre.
 */

/*
 * `prefer-title-case` é uma regra de inglês. Todo texto visível desta extensão é
 * pt-BR literal da UX-SPEC, e §10.1 exige frase com maiúscula só na primeira palavra
 * ("Copiar detalhes técnicos", nunca "Copiar Detalhes Técnicos").
 */
/* eslint-disable @raycast/prefer-title-case */

import { useCallback, useEffect, useState } from "react";
import { Action, ActionPanel, Color, Detail, Icon } from "@raycast/api";
import { isHermesAgent, resolveBaseUrl } from "./lib/discovery";
import {
  HermesAuthError,
  HermesError,
  HermesWrongServerError,
  isAbort,
  sanitizeTechnical,
  toHermesError,
} from "./lib/errors";
import { getCapabilities, hasFeature, health, listModels, listSessions } from "./lib/hermes-api";
import { resolveApiKey } from "./lib/preferences";
import { forgetDetectedApiKey } from "./lib/storage";
import { SYNC_PROMISE, OpenPreferencesAction } from "./components/common";
import {
  AutoDetectAction,
  CopyTechnicalAction,
  E3_TEXT,
  FirstRunScreen,
  ForgetKeyAction,
  ManualSetupAction,
  errorCopy,
  hostOf,
  technicalBlock,
  timestamp,
} from "./components/first-run";
import { SHORTCUTS } from "./components/shortcuts";
import type { Capabilities, HermesFeatures } from "./lib/types";

const COMMAND_TITLE = "Verificar conexão com Hermes";

/* ───────────────────────────── Passos do diagnóstico ──────────────────────── */

type StepId = "endereco" | "ligado" | "chave" | "recursos" | "conversas";
type StepState = "pendente" | "ok" | "ressalva" | "falha";

const STEP_ORDER: readonly StepId[] = ["endereco", "ligado", "chave", "recursos", "conversas"];

const STEP_LABEL: Record<StepId, string> = {
  endereco: "Encontrando o Hermes",
  ligado: "Verificando se o Hermes está ligado",
  chave: "Testando sua chave de acesso",
  recursos: "Conferindo os recursos disponíveis",
  conversas: "Procurando suas conversas",
};

/** §2.7: ✅ sucesso, ⚠️ funciona com ressalva, ❌ falha, `…` ainda não executado. */
const MARK: Record<StepState, string> = { pendente: "…", ok: "✅", ressalva: "⚠️", falha: "❌" };

interface Step {
  state: StepState;
  text: string;
}

function pendingSteps(): Record<StepId, Step> {
  return {
    endereco: { state: "pendente", text: STEP_LABEL.endereco },
    ligado: { state: "pendente", text: STEP_LABEL.ligado },
    chave: { state: "pendente", text: STEP_LABEL.chave },
    recursos: { state: "pendente", text: STEP_LABEL.recursos },
    conversas: { state: "pendente", text: STEP_LABEL.conversas },
  };
}

interface Diagnostic {
  steps: Record<StepId, Step>;
  running: boolean;
  /** Nenhuma chave configurada (E4): a tela vira a de primeiro uso (§3.4). */
  noKey: boolean;
  baseUrl?: string;
  version?: string;
  capabilities?: Capabilities;
  hasSessions?: boolean;
  /** Só a ORIGEM da chave; o valor nunca chega até aqui. */
  keySource?: "preference" | "detected";
  error?: { text: string; uxId?: string };
  /** Já sanitizado. É o único texto técnico que esta tela pode exibir ou copiar. */
  technical: string;
}

function emptyDiagnostic(): Diagnostic {
  return { steps: pendingSteps(), running: true, noKey: false, technical: "" };
}

/* ──────────────────────── Mapa de recursos (§2.7, D-04) ───────────────────── */

interface CapabilityRow {
  readonly feature: keyof HermesFeatures;
  /** Nome na lista detalhada. */
  readonly name: string;
  /** Nome curto na linha-resumo do passo 4. */
  readonly short: string;
  /** Entra na linha-resumo. */
  readonly inSummary: boolean;
  /** Sem isto a extensão não faz o essencial: a linha vira ⚠️. */
  readonly core: boolean;
}

/**
 * Traduz o mapa `features` de `/v1/capabilities` para o que o usuário reconhece.
 * Nenhuma flag crua aparece na tela. D-04: neste servidor `jobs_admin` e
 * `memory_write_api` vêm `false`, e isso é normal — a lista mostra o que falta sem
 * transformar em erro.
 */
const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  { feature: "session_chat", name: "Conversas", short: "conversas", inSummary: true, core: true },
  { feature: "run_submission", name: "Tarefas", short: "tarefas", inSummary: true, core: true },
  {
    feature: "run_approval_response",
    name: "Pedidos de aprovação",
    short: "aprovações",
    inSummary: true,
    core: true,
  },
  {
    feature: "run_events_sse",
    name: "Resposta escrita na hora",
    short: "resposta na hora",
    inSummary: true,
    core: false,
  },
  { feature: "model_options", name: "Escolha de modelo", short: "modelos", inSummary: false, core: false },
  { feature: "skills_api", name: "Skills", short: "skills", inSummary: false, core: false },
  { feature: "jobs_admin", name: "Automações", short: "automações", inSummary: false, core: false },
  {
    feature: "memory_write_api",
    name: "Memória de longo prazo",
    short: "memória de longo prazo",
    inSummary: false,
    core: false,
  },
];

function capabilitiesSection(capabilities: Capabilities | undefined): string {
  if (capabilities === undefined) return "";
  const lines = ["## O que está disponível", ""];
  const missing: string[] = [];
  for (const row of CAPABILITY_ROWS) {
    const available = hasFeature(capabilities, row.feature);
    lines.push(`- ${available ? "✅" : "—"} ${row.name}`);
    if (!available) missing.push(row.short);
  }
  if (missing.length > 0) {
    lines.push("", `Não disponível neste Hermes: ${missing.join(", ")}. Isso não atrapalha o resto.`);
  }
  return lines.join("\n");
}

/* ─────────────────────── Detalhes técnicos do diagnóstico ─────────────────── */

function technicalText(params: { baseUrl?: string; step?: StepId; error?: HermesError }): string {
  const lines = [
    `Endereço: ${params.baseUrl ?? "não resolvido"}`,
    `Passo: ${params.step === undefined ? "todos concluídos" : STEP_LABEL[params.step]}`,
    `Resposta: ${params.error?.httpStatus ?? "-"}`,
    `Código: ${params.error?.code ?? "-"}`,
    `Momento: ${timestamp()}`,
  ];
  if (params.error !== undefined) lines.push("", params.error.technical);
  return lines.join("\n");
}

/**
 * SEGURANÇA (§5.1 regra 5): a chave entra aqui SÓ como segredo a ser substituído por
 * `[chave omitida]`. Ela não é guardada, não é devolvida e não sobrevive à função. O
 * filtro roda mesmo quando não há chave carregada — nunca é pulado.
 */
async function sanitizeWithKey(text: string): Promise<string> {
  const { key } = await resolveApiKey();
  return sanitizeTechnical(text, key === "" ? [] : [key]);
}

/* ──────────────────────────── O diagnóstico (§2.7) ────────────────────────── */

async function runDiagnostic(signal: AbortSignal, publish: (diagnostic: Diagnostic) => void): Promise<void> {
  // Guarda de configuração (§2.2): sem chave, nenhuma requisição sai daqui. Só a
  // ORIGEM é lida; o valor da chave não entra nesta tela em momento nenhum.
  const { source } = await resolveApiKey();
  if (signal.aborted) return;
  if (source === "none") {
    publish({ steps: pendingSteps(), running: false, noKey: true, technical: "" });
    return;
  }
  const keySource = source;

  const steps = pendingSteps();
  let baseUrl: string | undefined;
  let version: string | undefined;
  let capabilities: Capabilities | undefined;
  let hasSessions: boolean | undefined;

  const snapshot = (extra: Partial<Diagnostic>): Diagnostic => ({
    steps: { ...steps },
    running: true,
    noKey: false,
    baseUrl,
    version,
    capabilities,
    hasSessions,
    keySource,
    technical: "",
    ...extra,
  });

  const finish = async (error?: HermesError, step?: StepId): Promise<void> => {
    const technical = await sanitizeWithKey(technicalText({ baseUrl, step, error }));
    if (signal.aborted) return;
    publish(snapshot({ running: false, technical, error: error === undefined ? undefined : errorCopy(error) }));
  };

  /** Executa um passo, publica o resultado e devolve `false` quando a tela deve parar. */
  const attempt = async (
    id: StepId,
    action: () => Promise<{ text: string; state?: StepState }>,
    failureLine: (error: HermesError) => string,
    context: string,
  ): Promise<boolean> => {
    try {
      const result = await action();
      if (signal.aborted) return false;
      steps[id] = { state: result.state ?? "ok", text: result.text };
      publish(snapshot({}));
      return true;
    } catch (err) {
      if (signal.aborted || isAbort(err)) return false;
      const error = toHermesError(err, context);
      steps[id] = { state: "falha", text: failureLine(error) };
      // §3.3: um 401 invalida SÓ a chave detectada. A preferência é intenção
      // explícita do usuário e nunca é apagada por nós.
      if (error instanceof HermesAuthError && keySource === "detected") await forgetDetectedApiKey();
      await finish(error, id);
      return false;
    }
  };

  publish(snapshot({}));

  const foundAddress = await attempt(
    "endereco",
    async () => {
      // `force: true` ignora o cache de endpoint: um diagnóstico que confia em cache
      // não é diagnóstico.
      const endpoint = await resolveBaseUrl({ force: true });
      baseUrl = endpoint.baseUrl;
      version = endpoint.version;
      return { text: `Hermes encontrado em ${hostOf(endpoint.baseUrl)}` };
    },
    (error) =>
      error instanceof HermesWrongServerError
        ? "Encontrei outro programa nesse endereço"
        : "Não encontrei o Hermes neste computador",
    "descoberta do endereço do Hermes",
  );
  if (!foundAddress) return;

  const isUp = await attempt(
    "ligado",
    async () => {
      const info = await health(signal);
      // A porta 8644 também responde `/health`, com `platform: "webhook"`. Sem esta
      // asserção o diagnóstico diria "ligado" apontando para o adaptador errado.
      if (!isHermesAgent(info)) {
        throw new HermesWrongServerError({
          userMessage: E3_TEXT,
          technical:
            `GET ${baseUrl ?? ""}/health respondeu platform="${info.platform}", status="${info.status}". ` +
            `Esperado platform="hermes-agent".`,
          recovery: "open_preferences",
        });
      }
      version = info.version;
      return { text: `Hermes está ligado (versão ${info.version})` };
    },
    (error) =>
      error instanceof HermesWrongServerError ? "O programa nesse endereço não é o Hermes" : "O Hermes não respondeu",
    "GET /health",
  );
  if (!isUp) return;

  const keyWorks = await attempt(
    "chave",
    async () => {
      await listModels(signal);
      return { text: "Sua chave de acesso funciona" };
    },
    (error) =>
      error instanceof HermesAuthError ? "Sua chave de acesso não foi aceita" : "Não consegui testar a chave de acesso",
    "GET /v1/models",
  );
  if (!keyWorks) return;

  const gotCapabilities = await attempt(
    "recursos",
    async () => {
      const loaded = await getCapabilities(signal);
      capabilities = loaded;
      const summary = CAPABILITY_ROWS.filter((row) => row.inSummary && hasFeature(loaded, row.feature));
      const missingCore = CAPABILITY_ROWS.some((row) => row.core && !hasFeature(loaded, row.feature));
      const names = summary.length > 0 ? summary.map((row) => row.short).join(", ") : "nenhum";
      return { state: missingCore ? "ressalva" : "ok", text: `Recursos disponíveis: ${names}` };
    },
    () => "Não consegui conferir os recursos disponíveis",
    "GET /v1/capabilities",
  );
  if (!gotCapabilities) return;

  const sawSessions = await attempt(
    "conversas",
    async () => {
      // `limit=1` só prova que o banco de conversas responde. A API não devolve um
      // total, então esta tela não inventa um número.
      const page = await listSessions({ limit: 1, signal });
      hasSessions = page.data.length > 0;
      return { text: hasSessions ? "Suas conversas foram encontradas" : "Nenhuma conversa por aqui ainda" };
    },
    () => "Não consegui ver suas conversas",
    "GET /api/sessions",
  );
  if (!sawSessions) return;

  await finish();
}

function diagnosticMarkdown(diagnostic: Diagnostic, showTechnical: boolean): string {
  const failed = diagnostic.error !== undefined;
  const blocks: string[] = [];

  if (diagnostic.running) {
    blocks.push("# Verificando a conexão", "", "Isso leva alguns segundos.", "");
  } else if (failed) {
    blocks.push("# Não foi possível conectar", "", diagnostic.error?.text ?? "", "");
  } else {
    blocks.push("# Tudo certo", "", "O Raycast está conectado ao Hermes deste computador.", "");
  }

  for (const id of STEP_ORDER) {
    const step = diagnostic.steps[id];
    // Depois de uma falha o diagnóstico para: passos que não rodaram não viram linha.
    if (failed && step.state === "pendente") continue;
    blocks.push(`- ${MARK[step.state]} ${step.text}`);
  }

  if (!diagnostic.running && !failed) {
    const section = capabilitiesSection(diagnostic.capabilities);
    if (section !== "") blocks.push("", section);
    blocks.push("", SYNC_PROMISE);
  }

  if (showTechnical && diagnostic.technical !== "") {
    blocks.push("", technicalBlock(diagnostic.technical));
  }

  return blocks.join("\n");
}

function DiagnosticMetadata({ diagnostic }: { diagnostic: Diagnostic }) {
  // "Estado" aqui é o da CONEXÃO, não o de uma execução: por isso nenhum dos 7
  // rótulos de `status.ts` aparece — reusá-los seria mentir sobre o que é medido.
  const state = diagnostic.running
    ? { text: "Verificando", color: Color.SecondaryText }
    : diagnostic.error !== undefined
      ? { text: "Com problema", color: Color.Red }
      : { text: "Tudo certo", color: Color.Green };

  const sessions = diagnostic.hasSessions === undefined ? "—" : diagnostic.hasSessions ? "Sim" : "Nenhuma ainda";

  return (
    <Detail.Metadata>
      {/* A chave de acesso NUNCA aparece aqui, nem mascarada (§2.7). */}
      <Detail.Metadata.Label
        title="Endereço"
        text={diagnostic.baseUrl === undefined ? "—" : hostOf(diagnostic.baseUrl)}
        icon={Icon.Plug}
      />
      <Detail.Metadata.Label title="Versão do Hermes" text={diagnostic.version ?? "—"} />
      <Detail.Metadata.TagList title="Estado">
        <Detail.Metadata.TagList.Item text={state.text} color={state.color} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.Label title="Conversas encontradas" text={sessions} />
    </Detail.Metadata>
  );
}

/* ──────────────────────── Tela do diagnóstico (§2.7) ───────────────────────── */

export default function Command() {
  const [attempt, setAttempt] = useState(0);
  const [diagnostic, setDiagnostic] = useState<Diagnostic>(emptyDiagnostic);
  const [showTechnical, setShowTechnical] = useState(false);

  const retry = useCallback(() => {
    setDiagnostic(emptyDiagnostic());
    setShowTechnical(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    // StrictMode do React 19 roda o efeito duas vezes em desenvolvimento: sem o
    // AbortController + `alive` teríamos dois diagnósticos intercalados e setState
    // depois da desmontagem.
    const controller = new AbortController();
    let alive = true;

    const publish = (next: Diagnostic): void => {
      if (alive) setDiagnostic(next);
    };

    void runDiagnostic(controller.signal, publish).catch(async (err: unknown) => {
      if (!alive || isAbort(err)) return;
      const error = toHermesError(err, "verificação de conexão");
      const technical = await sanitizeWithKey(technicalText({ error }));
      publish({ steps: pendingSteps(), running: false, noKey: false, technical, error: errorCopy(error) });
    });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [attempt]);

  if (diagnostic.noKey) return <FirstRunScreen navigationTitle={COMMAND_TITLE} onDone={retry} />;

  const testTitle = diagnostic.error === undefined ? "Testar de novo" : "Tentar novamente";
  const testAction = (
    <Action title={testTitle} icon={Icon.ArrowClockwise} shortcut={SHORTCUTS.testConnection} onAction={retry} />
  );
  // §5.2 (E2): quando a chave foi recusada, detectar de novo é o que resolve — então
  // ela vira a ação primária. Nos outros casos a primária é testar de novo.
  const detectFirst = diagnostic.error?.uxId === "E2";

  return (
    <Detail
      isLoading={diagnostic.running}
      navigationTitle={COMMAND_TITLE}
      markdown={diagnosticMarkdown(diagnostic, showTechnical)}
      metadata={<DiagnosticMetadata diagnostic={diagnostic} />}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {detectFirst ? <AutoDetectAction onDone={retry} /> : testAction}
            {detectFirst ? testAction : <AutoDetectAction onDone={retry} />}
            <OpenPreferencesAction />
            <ManualSetupAction />
          </ActionPanel.Section>
          <ActionPanel.Section title="Detalhes técnicos">
            <Action
              title={showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
              icon={showTechnical ? Icon.EyeDisabled : Icon.Eye}
              shortcut={SHORTCUTS.showTechnical}
              onAction={() => setShowTechnical((value) => !value)}
            />
            <CopyTechnicalAction technical={diagnostic.technical} />
          </ActionPanel.Section>
          {diagnostic.keySource === "detected" ? (
            <ActionPanel.Section>
              <ForgetKeyAction onDone={retry} />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    />
  );
}
