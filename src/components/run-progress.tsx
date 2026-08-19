/* eslint-disable @raycast/prefer-title-case -- a UX-SPEC §10.1 exige título de ação em
   frase, em pt-BR ("Copiar resposta", nunca "Copiar Resposta"); a regra é calibrada para o
   Title Case do inglês e `ray lint --fix` reescreve a copy do produto sem ela. */

/**
 * `RunProgressView` — acompanhar uma execução do Hermes que JÁ EXISTE.
 *
 * A diferença para `useRunStream` (`src/hooks/use-run-stream.ts`, o motor de
 * `Perguntar ao Hermes`) é o ponto de partida: lá a tela cria a run e assina o stream na
 * hora; aqui a tela recebe um `run_id` que pode ter nascido em outra janela, em outro dia,
 * ou até no Hermes Desktop. É o caso de `Execuções do Hermes` e o da tarefa longa que o
 * usuário reabre depois de fechar o Raycast.
 *
 * Por isso o stream é OPCIONAL (`attachStream`): o transporte de eventos tem consumidor
 * único e não é retomável — reconectar devolve 404 embora a run siga viva (armadilhas 14 e
 * 16). Quando não há stream, o acompanhamento é `GET /v1/runs/{id}` a cada 2 s (§8.5).
 *
 * O que esta tela NÃO faz, de propósito, porque já existe em um lugar só:
 * - a tabela de atalhos vem de `./shortcuts`;
 * - a tela de aprovação vem de `./approval-view`;
 * - a tela de primeiro uso vem de `./not-configured`;
 * - os rótulos dos 7 estados vêm de `src/lib/status.ts`;
 * - HTTP, SSE e mapeamento de erro vêm de `src/lib/`.
 */

import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Detail,
  Icon,
  LaunchType,
  Toast,
  launchCommand,
  openExtensionPreferences,
  showHUD,
  showToast,
} from "@raycast/api";
import { useEffect, useReducer, useRef, useState, type ReactElement } from "react";

import { APPROVAL_CHOICE_LABEL } from "../hooks/use-run-stream";
import { hermesDesktopSessionUrl } from "../lib/discovery";
import { HermesError, isAbort, sanitizeTechnical, toHermesError } from "../lib/errors";
import { getRun, openRunEventStream, reconcileRun, stopRun } from "../lib/hermes-api";
import { consumeRunEventStream, createTextBuffer, type RunStreamResult } from "../lib/hermes-events";
import {
  RUN_EXPIRED,
  RUN_EXPIRED_DETAIL,
  isTerminalRunStatus,
  runStatusAppearance,
  runStatusLabel,
  type StatusAppearance,
} from "../lib/status";
import {
  clearApprovalRequest,
  loadApprovalRequest,
  loadRunResult,
  saveApprovalRequest,
  saveRunResult,
  updateStoredRun,
  type StoredApproval,
} from "../lib/storage";
import type { ApprovalChoice, ApprovalRequestFields, HermesUsage, Run } from "../lib/types";
import { ApprovalView } from "./approval-view";
import { confirmStopRun } from "./common";
import { SteerForm, steerAndReport } from "./steer-form";
import { SHORTCUTS } from "./shortcuts";

/** UX-SPEC §8.5: 2 s para a execução aberta, enquanto o estado não for terminal. */
export const RUN_POLL_MS = 2_000;

/** UX-SPEC §6.1: a única troca de texto automática da tela. */
const THINKING_AFTER_MS = 3_000;

/* ═══════════════════════════ Utilidades de exibição ═══════════════════════════ */

/**
 * `status.ts` guarda ícone e cor como o VALOR literal do enum, para poder ser carregado sob
 * `node --test` (onde `@raycast/api` não tem runtime). Aqui os valores voltam ao tipo do
 * enum: a asserção é segura porque `status.ts` amarra cada literal ao membro real em tempo
 * de compilação (`satisfies IconMembers` / `satisfies ColorMembers`), então um nome
 * inventado ou um valor que mude de string não compilaria lá.
 */
export function statusImage(appearance: StatusAppearance): { source: Icon; tintColor: Color } {
  return { source: appearance.icon as Icon, tintColor: appearance.color as Color };
}

/** Primeira linha do texto, colapsada e cortada, para cabeçalhos e títulos de item. */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/** UX-SPEC §10.1: número com vírgula decimal. */
function decimal(value: number, digits = 1): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * `StoredApproval` (o que sobrevive ao fechamento da janela) de volta ao formato do evento,
 * que é o que a tela de aprovação lê. O `as` é necessário porque o índice local guarda
 * `choices` como `string[]`: um valor novo que o servidor passe a emitir não pode derrubar a
 * leitura do registro, e a tela de aprovação ignora `choice` que não reconhece.
 */
export function approvalFields(stored: StoredApproval | undefined): ApprovalRequestFields {
  return {
    command: stored?.command,
    description: stored?.description,
    choices: (stored?.choices ?? ["deny"]) as ApprovalChoice[],
    request_id: stored?.requestId,
    pattern_key: stored?.patternKey,
    pattern_keys: stored?.patternKeys,
    smart_denied: stored?.smartDenied,
  };
}

/* ════════════════════════════ Detalhes técnicos ════════════════════════════ */

export interface TechnicalContext {
  runId: string;
  sessionId?: string;
  status?: string;
  lastEvent?: string;
  error?: HermesError;
}

/**
 * Bloco de "Detalhes técnicos" no formato da UX-SPEC §5.1, oculto por padrão em toda tela.
 * Passa SEMPRE por `sanitizeTechnical()`: a regra 5 da spec proíbe pular o filtro, inclusive
 * quando a chave nem está carregada, e este é o único texto da tela que carrega conteúdo
 * vindo do servidor.
 */
export function technicalDetails(ctx: TechnicalContext): string {
  const lines = [
    `Identificador da tarefa: ${ctx.runId}`,
    ctx.sessionId !== undefined ? `Conversa: ${ctx.sessionId}` : undefined,
    ctx.status !== undefined ? `Estado: ${ctx.status}` : undefined,
    ctx.lastEvent !== undefined ? `Último evento: ${ctx.lastEvent}` : undefined,
    ctx.error?.httpStatus !== undefined ? `Resposta: ${ctx.error.httpStatus}` : undefined,
    ctx.error?.code ? `Código: ${ctx.error.code}` : undefined,
    ctx.error !== undefined ? `Detalhe: ${ctx.error.technical}` : undefined,
    `Momento: ${new Date().toLocaleString("pt-BR")}`,
  ].filter((line): line is string => line !== undefined);

  return sanitizeTechnical(lines.join("\n"));
}

function technicalMarkdown(ctx: TechnicalContext): string {
  return ["### Detalhes técnicos", "", "```", technicalDetails(ctx), "```"].join("\n");
}

/* ═══════════════════════════ Tela de erro reutilizável ═══════════════════════════ */

export function ErrorDetail(props: {
  navigationTitle: string;
  error: HermesError;
  technicalContext: TechnicalContext;
  onRetry?: () => void;
}): ReactElement {
  const [showTechnical, setShowTechnical] = useState(false);
  const ctx: TechnicalContext = { ...props.technicalContext, error: props.error };
  const markdown = [props.error.userMessage, showTechnical ? technicalMarkdown(ctx) : undefined]
    .filter((block): block is string => block !== undefined)
    .join("\n\n");

  return (
    <Detail
      navigationTitle={props.navigationTitle}
      markdown={markdown}
      actions={
        <ActionPanel>
          {props.onRetry !== undefined && (
            <Action
              title="Tentar novamente"
              icon={Icon.ArrowClockwise}
              shortcut={SHORTCUTS.refresh}
              onAction={props.onRetry}
            />
          )}
          <Action
            title="Abrir configurações"
            icon={Icon.Gear}
            shortcut={SHORTCUTS.preferences}
            onAction={openExtensionPreferences}
          />
          <Action
            title={showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
            icon={showTechnical ? Icon.EyeDisabled : Icon.Eye}
            shortcut={SHORTCUTS.showTechnical}
            onAction={() => setShowTechnical(!showTechnical)}
          />
          <Action.CopyToClipboard
            title="Copiar detalhes técnicos"
            content={technicalDetails(ctx)}
            shortcut={SHORTCUTS.copyTechnical}
          />
        </ActionPanel>
      }
    />
  );
}

/* ══════════════════════════════ Estado da tela ══════════════════════════════ */

export type ViewMode = "etapas" | "resposta";

interface Step {
  id: number;
  line: string;
}

interface RunViewState {
  status?: string;
  /** `GET /v1/runs/{id}` devolveu 404: é condição, não estado (UX-SPEC §4.3). */
  expired: boolean;
  text: string;
  steps: Step[];
  nextStepId: number;
  /** Ferramenta rodando agora; some no `tool.completed` (UX-SPEC §6.3). */
  currentTool?: string;
  /** Nomes distintos das ferramentas usadas, para a TagList "Etapas". */
  tools: string[];
  approval?: StoredApproval;
  approvalLoaded: boolean;
  pendingApprovals: number;
  /**
   * UX-SPEC §4.4: `waiting_for_approval` gruda no polling quando a aprovação é respondida
   * em outro aplicativo. A partir do primeiro evento posterior, o stream vence o polling.
   */
  eventsBeatPolling: boolean;
  runError?: string;
  pendingSteer?: string;
  usage?: HermesUsage;
  startedAt: number;
  durationSeconds?: number;
  model?: string;
  sessionId?: string;
  /** Erro que toma a tela inteira (UX-SPEC §5.3). */
  screenError?: HermesError;
  /** Avisos em bloco de citação, acumulados no topo do markdown. */
  notices: string[];
  stopping: boolean;
  isLoading: boolean;
}

type RunViewAction =
  | { type: "text"; text: string }
  | { type: "tool-started"; tool: string; preview: string | null }
  | { type: "tool-completed"; tool: string; duration: number; failed: boolean }
  | { type: "reasoning"; text: string }
  | { type: "subagent"; line: string }
  | { type: "approval-request"; approval: StoredApproval }
  | { type: "approval-loaded"; approval?: StoredApproval }
  | { type: "approval-responded"; choice: ApprovalChoice; resolved: number }
  | { type: "steered" }
  | { type: "polled"; run: Run }
  | { type: "expired" }
  | { type: "stream-result"; result: RunStreamResult }
  | { type: "stopping" }
  | { type: "notice"; text: string }
  | { type: "screen-error"; error: HermesError }
  | { type: "loaded" };

function withStep(state: RunViewState, line: string): RunViewState {
  return { ...state, steps: [...state.steps, { id: state.nextStepId, line }], nextStepId: state.nextStepId + 1 };
}

function withNotice(state: RunViewState, text: string): RunViewState {
  return state.notices.includes(text) ? state : { ...state, notices: [...state.notices, text] };
}

function reduce(state: RunViewState, action: RunViewAction): RunViewState {
  switch (action.type) {
    case "text":
      return { ...state, text: action.text, isLoading: false };

    case "tool-started": {
      const line = action.preview ? `🔧 Usando ${action.tool} — ${action.preview}` : `🔧 Usando ${action.tool}`;
      const tools = state.tools.includes(action.tool) ? state.tools : [...state.tools, action.tool];
      return withStep({ ...state, currentTool: action.tool, tools, eventsBeatPolling: true }, line);
    }

    case "tool-completed": {
      // Armadilha 28: falha de ferramenta chega como `tool.completed` com `error: true`.
      const line = action.failed
        ? `⚠️ ${action.tool} falhou depois de ${decimal(action.duration)} s`
        : `✅ ${action.tool} concluído em ${decimal(action.duration)} s`;
      const currentTool = state.currentTool === action.tool ? undefined : state.currentTool;
      return withStep({ ...state, currentTool, eventsBeatPolling: true }, line);
    }

    case "reasoning":
      return withStep(state, `💭 ${shorten(action.text, 100)}`);

    case "subagent":
      return withStep(state, action.line);

    case "approval-request":
      return withStep(
        {
          ...state,
          approval: action.approval,
          approvalLoaded: true,
          pendingApprovals: state.pendingApprovals + 1,
          status: "waiting_for_approval",
          eventsBeatPolling: false,
        },
        "🔐 O Hermes pediu sua aprovação",
      );

    case "approval-loaded":
      return {
        ...state,
        approval: action.approval,
        approvalLoaded: true,
        pendingApprovals: Math.max(state.pendingApprovals, 1),
      };

    case "approval-responded": {
      const resolved = Math.max(action.resolved, 1);
      return withStep(
        {
          ...state,
          approval: undefined,
          approvalLoaded: false,
          pendingApprovals: Math.max(state.pendingApprovals - resolved, 0),
          // Evento posterior ao pedido: daqui em diante o polling não pode reinstalar
          // "Aguardando aprovação" (UX-SPEC §4.4).
          eventsBeatPolling: true,
          status: "running",
        },
        `🔐 Aprovação respondida: ${APPROVAL_CHOICE_LABEL[action.choice]}`,
      );
    }

    case "steered":
      return withStep(state, "🧭 Orientação enviada");

    case "polled": {
      const run = action.run;
      const sticky = run.status === "waiting_for_approval" && state.eventsBeatPolling;
      const terminal = isTerminalRunStatus(run.status);
      return {
        ...state,
        expired: false,
        status: sticky ? state.status : run.status,
        model: run.model ?? state.model,
        sessionId: run.session_id ?? state.sessionId,
        usage: run.usage ?? state.usage,
        pendingSteer: run.pending_steer ?? state.pendingSteer,
        runError: run.error ?? state.runError,
        // O texto do polling só entra quando a run terminou: durante o stream, o acumulado
        // dos deltas é mais recente que qualquer coisa que o GET devolva.
        text: terminal && run.output !== undefined ? run.output : state.text,
        durationSeconds: terminal ? Math.max(run.updated_at - run.created_at, 0) : state.durationSeconds,
        currentTool: terminal ? undefined : state.currentTool,
        stopping: terminal ? false : state.stopping,
        isLoading: false,
      };
    }

    case "expired":
      return { ...state, expired: true, currentTool: undefined, stopping: false, isLoading: false };

    case "stream-result": {
      const result = action.result;
      // Abortado = a tela está desmontando. A run continua no servidor (D-02).
      if (result.aborted) return state;
      const status =
        result.terminalEvent === "run.completed"
          ? "completed"
          : result.terminalEvent === "run.failed"
            ? "failed"
            : result.terminalEvent === "run.cancelled"
              ? "cancelled"
              : state.status;
      return {
        ...state,
        status,
        // O texto final autoritativo é o `output` do `run.completed` (UX-SPEC §6.2).
        text: result.output ?? (result.text !== "" ? result.text : state.text),
        usage: result.usage ?? state.usage,
        runError: result.error ?? state.runError,
        pendingSteer: result.pendingSteer ?? state.pendingSteer,
        currentTool: undefined,
        durationSeconds: isTerminalRunStatus(status) ? (Date.now() - state.startedAt) / 1000 : state.durationSeconds,
        isLoading: false,
      };
    }

    case "stopping":
      return { ...state, stopping: true, status: "stopping" };

    case "notice":
      return withNotice(state, action.text);

    case "screen-error":
      return { ...state, screenError: action.error, isLoading: false };

    case "loaded":
      return { ...state, isLoading: false };
  }
}

function initialState(props: RunProgressViewProps): RunViewState {
  return {
    expired: false,
    text: "",
    steps: [],
    nextStepId: 1,
    tools: [],
    approvalLoaded: false,
    pendingApprovals: 0,
    eventsBeatPolling: false,
    startedAt: props.createdAt ?? Date.now(),
    model: props.model,
    sessionId: props.sessionId,
    notices: [],
    stopping: false,
    isLoading: true,
  };
}

/* ══════════════════════════ Tela de acompanhamento ══════════════════════════ */

export interface RunProgressViewProps {
  runId: string;
  /** Texto da tarefa: vira cabeçalho e `navigationTitle`. */
  prompt: string;
  sessionId?: string;
  sessionTitle?: string;
  model?: string;
  createdAt?: number;
  /**
   * `true` SOMENTE quando esta tela acabou de disparar a run. O stream de eventos tem
   * consumidor único e não é retomável: reconectar devolve 404 enquanto a run segue viva
   * (armadilhas 14 e 15). Ao REABRIR uma execução, a recuperação é o polling de 2 s.
   */
  attachStream: boolean;
  /** `run-task` abre em Etapas (UX-SPEC §2.4.2); `Ctrl+T` alterna. */
  initialMode?: ViewMode;
}

export function RunProgressView(props: RunProgressViewProps): ReactElement {
  const { runId, prompt, attachStream } = props;

  const [state, dispatch] = useReducer(reduce, props, initialState);
  const [mode, setMode] = useState<ViewMode>(props.initialMode ?? "resposta");
  const [showTechnical, setShowTechnical] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [nonce, setNonce] = useState(0);

  const terminal = state.expired || isTerminalRunStatus(state.status);
  const sessionId = state.sessionId ?? props.sessionId;
  const desktopUrl = hermesDesktopSessionUrl(sessionId);

  /** Lido dentro do polling sem entrar nas dependências: só decide ONDE o erro aparece. */
  const hasContentRef = useRef(false);
  hasContentRef.current = state.text !== "" || state.steps.length > 0;

  /* ── Stream de eventos: só na execução recém-criada ── */
  useEffect(() => {
    if (!attachStream) return;

    const controller = new AbortController();
    let cancelled = false;
    const buffer = createTextBuffer((text) => {
      if (!cancelled) dispatch({ type: "text", text });
    });

    void (async () => {
      try {
        const response = await openRunEventStream(runId, controller.signal);
        if (cancelled) return;

        const result = await consumeRunEventStream(
          response,
          runId,
          {
            onText: buffer.push,
            onToolStarted: (tool, preview) => {
              if (!cancelled) dispatch({ type: "tool-started", tool, preview });
            },
            onToolCompleted: (tool, duration, failed) => {
              if (!cancelled) dispatch({ type: "tool-completed", tool, duration, failed });
            },
            onReasoning: (text) => {
              if (!cancelled) dispatch({ type: "reasoning", text });
            },
            onSubagent: (event) => {
              if (cancelled) return;
              if (event.event === "subagent.start") {
                dispatch({ type: "subagent", line: `👥 Tarefa auxiliar iniciada: ${event.goal ?? "sem descrição"}` });
              } else if (event.event === "subagent.complete") {
                dispatch({ type: "subagent", line: `👥 Tarefa auxiliar concluída: ${event.summary ?? "sem resumo"}` });
              }
            },
            onApprovalRequest: (request) => {
              // Armadilha 24: não existe rota que liste aprovações pendentes. Gravar AGORA,
              // ou o usuário reabriria a tela sem enxergar o comando que está autorizando.
              const approval: StoredApproval = {
                runId,
                command: request.command,
                description: request.description,
                choices: request.choices ?? [],
                requestId: request.request_id,
                patternKey: request.pattern_key,
                patternKeys: request.pattern_keys,
                smartDenied: request.smart_denied,
                receivedAt: Date.now(),
              };
              void saveApprovalRequest(approval);
              if (!cancelled) dispatch({ type: "approval-request", approval });
            },
            onApprovalResponded: (choice, resolved) => {
              void clearApprovalRequest(runId);
              if (!cancelled) dispatch({ type: "approval-responded", choice, resolved });
            },
            onEvent: (event) => {
              if (!cancelled && event.event === "run.steered") dispatch({ type: "steered" });
            },
          },
          controller.signal,
        );

        buffer.flush();
        if (!cancelled) dispatch({ type: "stream-result", result });
      } catch (err) {
        buffer.cancel();
        if (cancelled || isAbort(err)) return;
        const error = toHermesError(err, "runEvents");
        // E9 e E23 nunca apagam o que o usuário já leu: viram aviso e o polling assume.
        dispatch({
          type: "notice",
          text:
            error.httpStatus === 404
              ? "Perdi o acompanhamento ao vivo desta tarefa, mas ela continua rodando no Hermes."
              : "A conexão com o Hermes caiu no meio da resposta. A tarefa continua rodando no Hermes.",
        });
      }
    })();

    return () => {
      cancelled = true;
      buffer.cancel();
      controller.abort(); // ÚNICO lugar que desliga o stream
    };
  }, [runId, attachStream]);

  /* ── Polling de 2 s (UX-SPEC §8.5). Um comando `view` só vive em primeiro plano: ao
        fechar a janela o componente desmonta e o cleanup abaixo encerra o ciclo. ── */
  useEffect(() => {
    if (terminal) return;

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      try {
        const run = await reconcileRun(runId, controller.signal);
        if (cancelled) return;
        // Armadilha 17: 404 é "expirado/perdido", jamais "falhou".
        if (run === "expired") dispatch({ type: "expired" });
        else dispatch({ type: "polled", run });
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        const error = toHermesError(err, "getRun");
        // Sem nada na tela, o erro toma a tela; com conteúdo, vira aviso e o ciclo
        // seguinte tenta de novo (UX-SPEC §5.3).
        if (hasContentRef.current) dispatch({ type: "notice", text: error.userMessage });
        else dispatch({ type: "screen-error", error });
      } finally {
        if (!cancelled) timer = setTimeout(() => void tick(), RUN_POLL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [runId, terminal, state.status, nonce]);

  /* ── Aprovação pendente reaberta: o payload só existe no LocalStorage (armadilha 24) ── */
  useEffect(() => {
    if (state.status !== "waiting_for_approval" || state.approvalLoaded) return;
    let cancelled = false;
    void loadApprovalRequest(runId).then((stored) => {
      if (!cancelled) dispatch({ type: "approval-loaded", approval: stored });
    });
    return () => {
      cancelled = true;
    };
  }, [runId, state.status, state.approvalLoaded]);

  /* ── Resultado gravado localmente: o servidor descarta o estado terminal em 1 h (§8.7) ── */
  useEffect(() => {
    if (state.status === undefined) return;
    void updateStoredRun(runId, { lastKnownStatus: state.status });
    if (!isTerminalRunStatus(state.status)) return;
    void saveRunResult({
      runId,
      status: state.status,
      output: state.text !== "" ? state.text : undefined,
      error: state.runError,
      savedAt: Date.now(),
    });
  }, [runId, state.status, state.text, state.runError]);

  /* ── Execução reaberta: mostra o resultado que já tínhamos, sem esperar o servidor ── */
  useEffect(() => {
    if (attachStream || state.text !== "") return;
    let cancelled = false;
    void loadRunResult(runId).then((stored) => {
      if (cancelled) return;
      if (stored?.output) dispatch({ type: "text", text: stored.output });
      else dispatch({ type: "loaded" });
    });
    return () => {
      cancelled = true;
    };
  }, [runId, attachStream, state.text]);

  /* ── UX-SPEC §6.1: "Preparando…" vira "O Hermes está pensando…" depois de 3 s ── */
  useEffect(() => {
    if (state.text !== "" || terminal) return;
    const timer = setTimeout(() => setThinking(true), THINKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state.text, terminal]);

  const technicalContext: TechnicalContext = {
    runId,
    sessionId,
    status: state.expired ? "run_not_found" : state.status,
    error: state.screenError,
  };

  function refresh(): void {
    setNonce((value) => value + 1);
  }

  async function handleStop(): Promise<void> {
    // DESVIO consciente da UX-SPEC §6.6.6, que dispensa a confirmação: a regra geral do
    // projeto manda `confirmAlert` em toda ação que o usuário não consegue desfazer.
    if (!(await confirmStopRun())) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Parando a tarefa…" });
    try {
      await stopRun(runId);
      dispatch({ type: "stopping" });
      toast.style = Toast.Style.Success;
      toast.title = "Tarefa parada";
    } catch (err) {
      const error = toHermesError(err, "stopRun");
      if (error.httpStatus === 404) {
        // Armadilha 21: 404 aqui significa "a tarefa já tinha terminado", nunca erro.
        toast.style = Toast.Style.Success;
        toast.title = "Tarefa parada";
        refresh();
        return;
      }
      toast.style = Toast.Style.Failure;
      toast.title = error.userMessage;
    }
  }

  if (state.screenError !== undefined && !hasContentRef.current) {
    return (
      <ErrorDetail
        navigationTitle={shorten(prompt, 40)}
        error={state.screenError}
        technicalContext={technicalContext}
        onRetry={refresh}
      />
    );
  }

  const appearance = state.expired ? RUN_EXPIRED : runStatusAppearance(state.status);
  const label = state.expired ? RUN_EXPIRED.label : runStatusLabel(state.status);

  return (
    <Detail
      navigationTitle={shorten(prompt, 40)}
      isLoading={state.isLoading || !terminal}
      markdown={buildMarkdown({
        state,
        prompt,
        mode,
        thinking,
        terminal,
        showTechnical,
        technicalContext,
        attachStream,
      })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Estado" text={label} icon={statusImage(appearance)} />
          <Detail.Metadata.Label title="Conversa" text={props.sessionTitle ?? "Sem título"} />
          <Detail.Metadata.Label title="Modelo" text={state.model ?? "Padrão do Hermes"} />
          {sessionId !== undefined && <Detail.Metadata.Label title="Sincronização" text="Aparece no Hermes Desktop" />}
          {state.durationSeconds !== undefined && (
            <Detail.Metadata.Label title="Duração" text={`${Math.round(state.durationSeconds)} s`} />
          )}
          {mode === "etapas" && state.tools.length > 0 && (
            <Detail.Metadata.TagList title="Etapas">
              {state.tools.slice(-6).map((tool) => (
                <Detail.Metadata.TagList.Item key={tool} text={tool} />
              ))}
            </Detail.Metadata.TagList>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {state.status === "waiting_for_approval" && !terminal && (
              <Action.Push
                title="Responder pedido de aprovação"
                icon={Icon.Lock}
                target={
                  <ApprovalView
                    runId={runId}
                    fields={approvalFields(state.approval)}
                    pendingCount={Math.max(state.pendingApprovals, 1)}
                    detailsLost={state.approvalLoaded && state.approval === undefined}
                    taskPreview={shorten(prompt, 60)}
                    conversationTitle={props.sessionTitle ?? "Sem título"}
                    sessionId={sessionId}
                    onResolved={(choice, resolved) => dispatch({ type: "approval-responded", choice, resolved })}
                  />
                }
              />
            )}
            {terminal && state.text !== "" && (
              <Action.CopyToClipboard
                title="Copiar resposta"
                content={state.text}
                shortcut={SHORTCUTS.copy}
                onCopy={() => void showHUD("Resposta copiada")}
              />
            )}
            {terminal && state.text !== "" && (
              <Action.Paste title="Colar no aplicativo ativo" content={state.text} shortcut={SHORTCUTS.paste} />
            )}
            {!terminal && state.text !== "" && (
              <Action.CopyToClipboard
                title="Copiar o que já veio"
                content={state.text}
                shortcut={SHORTCUTS.copy}
                onCopy={() => void showHUD("Resposta copiada")}
              />
            )}
            {desktopUrl !== undefined && (
              <Action.Open
                title="Abrir no Hermes Desktop"
                icon={Icon.Desktop}
                target={desktopUrl}
                shortcut={SHORTCUTS.openInDesktop}
              />
            )}
          </ActionPanel.Section>

          <ActionPanel.Section>
            {!terminal && (
              <Action
                title="Parar"
                icon={Icon.Stop}
                style={Action.Style.Destructive}
                shortcut={SHORTCUTS.stop}
                onAction={() => void handleStop()}
              />
            )}
            {state.status === "running" && (
              // Armadilha 22: fora de `running` o servidor recusa a orientação com 409.
              <Action.Push
                title="Orientar execução"
                icon={Icon.Compass}
                shortcut={SHORTCUTS.steer}
                target={
                  <SteerForm
                    onSend={async (text) => {
                      await steerAndReport(runId, text);
                      dispatch({ type: "steered" });
                    }}
                  />
                }
              />
            )}
            <Action
              title={mode === "etapas" ? "Ver resposta" : "Ver etapas"}
              icon={mode === "etapas" ? Icon.Text : Icon.List}
              shortcut={SHORTCUTS.toggleSteps}
              onAction={() => setMode(mode === "etapas" ? "resposta" : "etapas")}
            />
            <Action title="Atualizar" icon={Icon.ArrowClockwise} shortcut={SHORTCUTS.refresh} onAction={refresh} />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title="Nova tarefa"
              icon={Icon.Plus}
              shortcut={SHORTCUTS.newConversation}
              onAction={() => void launchCommand({ name: "run-task", type: LaunchType.UserInitiated })}
            />
            <Action
              title="Ver tarefas em andamento"
              icon={Icon.List}
              shortcut={SHORTCUTS.activeRuns}
              onAction={() => void launchCommand({ name: "active-runs", type: LaunchType.UserInitiated })}
            />
            {state.pendingSteer !== undefined && (
              <Action
                title="Enviar como nova pergunta"
                icon={Icon.Compass}
                onAction={() =>
                  void launchCommand({
                    name: "run-task",
                    type: LaunchType.UserInitiated,
                    arguments: { tarefa: state.pendingSteer ?? "" },
                  })
                }
              />
            )}
            {sessionId !== undefined && (
              // §8.4: o `hermes://` pode não estar registrado. O identificador é o plano B.
              <Action.CopyToClipboard title="Copiar identificador da conversa" content={sessionId} />
            )}
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title={showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
              icon={showTechnical ? Icon.EyeDisabled : Icon.Eye}
              shortcut={SHORTCUTS.showTechnical}
              onAction={() => setShowTechnical(!showTechnical)}
            />
            <Action
              title="Copiar detalhes técnicos"
              icon={Icon.Clipboard}
              shortcut={SHORTCUTS.copyTechnical}
              onAction={() => {
                void Clipboard.copy(technicalDetails(technicalContext)).then(() =>
                  showHUD("Detalhes técnicos copiados"),
                );
              }}
            />
            <Action
              title="Abrir configurações"
              icon={Icon.Gear}
              shortcut={SHORTCUTS.preferences}
              onAction={openExtensionPreferences}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/* ═════════════════════════════ Markdown da tela ═════════════════════════════ */

interface MarkdownInput {
  state: RunViewState;
  prompt: string;
  mode: ViewMode;
  thinking: boolean;
  terminal: boolean;
  showTechnical: boolean;
  technicalContext: TechnicalContext;
  attachStream: boolean;
}

function buildMarkdown(input: MarkdownInput): string {
  const { state, prompt, mode, thinking, terminal, showTechnical, technicalContext, attachStream } = input;
  const blocks: string[] = [`### ${shorten(prompt, 120)}`];

  /* Avisos: sempre no topo, sempre em bloco de citação, nunca apagando o que já foi lido. */
  if (!attachStream && !terminal) {
    blocks.push(
      "> Acompanhando esta tarefa em modo simples. O texto que passou enquanto o Raycast estava fechado não pode ser recuperado, mas o resultado final aparece aqui.",
    );
  }
  if (state.stopping) {
    blocks.push(
      "> Pedido de parada enviado. O Hermes está encerrando com segurança — isso pode levar alguns segundos se ele estiver no meio de uma ferramenta.",
    );
  }
  if (state.status === "waiting_for_approval" && !terminal) {
    blocks.push("> 🔐 **O Hermes precisa da sua permissão para continuar.**");
  }
  if (state.pendingApprovals > 1) {
    blocks.push(
      `> Existem ${state.pendingApprovals} pedidos de aprovação nesta tarefa. Sua resposta vale para o mais antigo deles.`,
    );
  }
  for (const notice of state.notices) blocks.push(`> ${notice}`);
  if (state.expired) blocks.push(RUN_EXPIRED_DETAIL);

  if (mode === "etapas") {
    // Etapas = uma linha por evento, em linguagem simples. Nunca JSON, nunca log cru
    // (UX-SPEC §6.3); o que é técnico mora atrás de "Mostrar detalhes técnicos".
    blocks.push(
      state.steps.length > 0 ? state.steps.map((step) => step.line).join("\n\n") : "_Nenhuma etapa até agora._",
    );
    if (terminal && state.text !== "") blocks.push("---", state.text);
  } else {
    if (state.currentTool !== undefined) blocks.push(`> 🔧 Usando ${state.currentTool}…`);
    if (state.text !== "") blocks.push(state.text);
    else if (terminal && !state.expired && state.runError === undefined) {
      blocks.push("O Hermes terminou sem escrever uma resposta.");
    } else if (!terminal) blocks.push(thinking ? "_O Hermes está pensando…_" : "_Preparando…_");
  }

  /* E21 / E22 — o erro entra ABAIXO do que o usuário já leu (UX-SPEC §5.3). */
  if (state.runError !== undefined) {
    blocks.push("---", `O Hermes não conseguiu concluir: ${state.runError}`);
  } else if (state.text.startsWith("⚠️ Provider authentication failed")) {
    blocks.push(
      "---",
      "O modelo escolhido não está autenticado no Hermes. Abra o Hermes Desktop e configure o provedor, ou escolha outro modelo.",
    );
  }

  if (state.pendingSteer !== undefined) {
    blocks.push("> Sua orientação chegou depois que o Hermes terminou. Quer enviá-la como próxima pergunta?");
  }

  if (showTechnical) blocks.push("---", technicalMarkdown(technicalContext));

  return blocks.join("\n\n");
}

/* ═════════════════════ Leitura do resultado, para as listas ═════════════════════ */

/**
 * Texto do resultado de uma execução, para `Copiar resultado`. Tenta o servidor primeiro e
 * cai no que foi gravado localmente — o Hermes descarta o estado terminal em 1 h (§8.7),
 * e depois disso a cópia local é a única que resta.
 */
export async function readRunOutput(runId: string): Promise<string | undefined> {
  try {
    const run = await getRun(runId);
    if (run.output !== undefined && run.output !== "") return run.output;
  } catch {
    // 404 ou Hermes fora do ar: seguimos para a cópia local, sem incomodar o usuário.
  }
  const stored = await loadRunResult(runId);
  return stored?.output;
}
