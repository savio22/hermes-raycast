/**
 * `useRunStream` — o motor de "Perguntar ao Hermes", do envio até o estado terminal.
 *
 * Sequência (D-01, provada contra o Hermes real):
 *
 *   POST /api/sessions {"source":"desktop","title":"<único>"}   ← só na conversa nova
 *   POST /v1/runs      {"input":"…","session_id":"<id>"}        → 202 {run_id, status:"started"}
 *   GET  /v1/runs/{run_id}/events                               → SSE, assinado NA HORA
 *
 * As três regras que moldam este arquivo:
 *
 * 1. **Fechar a janela do Raycast não cancela nada** (D-02, princípio 8 do brief). O
 *    `AbortController` da desmontagem aborta SÓ o leitor local; `POST /v1/runs/{id}/stop`
 *    nunca é chamado na limpeza. Por isso a criação da sessão e da run vai deliberadamente
 *    **sem** `AbortSignal`: se o usuário fechar a janela entre o clique e o 202, a tarefa
 *    ainda nasce e ainda é registrada no `LocalStorage`.
 * 2. **Não existe `GET /v1/runs`.** Quem não gravar o `run_id` perde a execução para sempre,
 *    então `rememberRun()` acontece antes de qualquer render (§2.1.2 passo 3), e todo
 *    `approval.request` é persistido no instante em que chega (04 §8.3).
 * 3. **O stream tem consumidor único e não é retomável.** Ao cair, reconectar dá 404 embora
 *    a run siga viva (armadilhas 14/16): a recuperação é consulta a `GET /v1/runs/{id}` a
 *    cada 2 s, nunca uma segunda tentativa cega de assinar.
 *
 * Este módulo não renderiza nada e não conhece a UX-SPEC: ele produz estado. Os rótulos dos
 * 7 estados saem de `src/lib/status.ts` na camada de view.
 */

import { showHUD, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveBaseUrl } from "../lib/discovery";
import { isAbort, toHermesError, type HermesError } from "../lib/errors";
import {
  askInSession,
  openRunEventStream,
  reconcileRun,
  startConversation,
  steerRun,
  stopRun,
} from "../lib/hermes-api";
import { consumeRunEventStream, createTextBuffer, type RunStreamHandlers } from "../lib/hermes-events";
import { getHermesPreferences } from "../lib/preferences";
import { isTerminalRunStatus } from "../lib/status";
import {
  clearApprovalRequest,
  loadApprovalRequest,
  readJson,
  rememberRun,
  saveApprovalRequest,
  saveRunResult,
  StorageKeys,
  updateStoredRun,
  writeJson,
} from "../lib/storage";
import type { ApprovalChoice, ApprovalRequestFields, HermesUsage, Run, RunStatus } from "../lib/types";

/** §8.5: 2 s é a cadência de acompanhamento de uma execução aberta sem stream. */
const POLL_INTERVAL_MS = 2_000;
/** §6.2: ~12 re-renders por segundo, no máximo (armadilha 55). */
const RENDER_BUFFER_MS = 80;
/** §6.1: a única troca automática de texto — `Preparando…` vira `O Hermes está pensando…`. */
const THINKING_AFTER_MS = 3_000;
/** `StoredRun.promptPreview` é só para identificar o item na lista (ARCHITECTURE §9.2). */
const PREVIEW_CHARS = 200;

/** §6.3 — como uma resposta de aprovação aparece na lista de etapas. */
export const APPROVAL_CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: "Aprovado uma vez",
  session: "Aprovado nesta execução",
  always: "Aprovado sempre",
  deny: "Negado",
};

export interface AskRequest {
  /** A pergunta. Vira a primeira mensagem da conversa e o título derivado. */
  prompt: string;
  /** Continuar uma conversa existente; ausente ⇒ criar uma nova com `source: "desktop"`. */
  sessionId?: string;
  sessionTitle?: string;
  /** Escolha explícita do formulário; vence a preferência e o LocalStorage (P3). */
  model?: string;
  provider?: string;
}

/** Erro que chegou DEPOIS de já haver texto na tela: some abaixo, nunca apaga (§5.3). */
export interface StreamFailure {
  message: string;
  /** `true` ⇒ dá para reassinar o stream (E23). `false` ⇒ só resta consultar (E9). */
  canReattach: boolean;
  technical: string;
}

export interface PendingApproval {
  /** Exatamente o que o servidor mandou: `command`, `description`, `choices`… (§7.1). */
  fields: ApprovalRequestFields;
  /** Quantos pedidos estão na fila FIFO desta run (§7.5). */
  pendingCount: number;
  receivedAt: number;
  /** `true` quando o payload se perdeu com a janela fechada (§7.6). */
  detailsLost: boolean;
}

export interface RunStreamState {
  runId?: string;
  sessionId?: string;
  sessionTitle?: string;
  /** Um dos 7 literais do Hermes. Começa em `queued` = **Preparando**. */
  status: RunStatus;
  text: string;
  /** Linhas prontas do modo Etapas (§6.3), em ordem cronológica. */
  steps: string[];
  /** Ferramenta em execução agora — a linha discreta do modo Resposta. */
  activeTool?: string;
  usage?: HermesUsage;
  model?: string;
  approval?: PendingApproval;
  /** Erro que impede a tela inteira (nada foi recebido ainda). */
  fatalError?: HermesError;
  streamFailure?: StreamFailure;
  /** `GET /v1/runs/{id}` devolveu 404: expirada, **nunca** "Falhou" (§4.3). */
  expired: boolean;
  /** `Parar` já foi enviado; a espera de `cancelled` é normal (§6.6). */
  stopRequested: boolean;
  /** Há um SSE conectado neste momento. */
  liveStream: boolean;
  /** Passaram 3 s sem nada chegar (§6.1). */
  thinking: boolean;
  /** A conversa foi criada agora por nós (decide o aviso de sincronia §8.2). */
  newConversation: boolean;
  startedAt: number;
  finishedAt?: number;
  pendingSteer?: string;
  /** Endereço resolvido, só para o bloco de detalhes técnicos (§5.1). */
  baseUrl?: string;
}

export interface RunStreamController {
  state: RunStreamState;
  /** `Parar` (§6.6). Único caminho que cancela a run no servidor. */
  stop: () => Promise<void>;
  /** `Orientar execução` (§6.7). Só aceito com o estado exatamente `running`. */
  steer: (text: string) => Promise<void>;
  /** `Acompanhar de novo` — reassina o stream da MESMA run (E23). */
  reattach: () => void;
  /** `Tentar novamente` — nova execução na mesma conversa. */
  retry: () => void;
  /** Chamado pela tela de aprovação depois do POST, para destravar a UI na hora. */
  approvalResolved: (resolved: number) => void;
}

type FollowMode = "stream" | "poll";

interface StartedRun {
  runId: string;
  sessionId?: string;
  sessionTitle?: string;
  newConversation: boolean;
  baseUrl: string;
}

interface ModelChoice {
  model?: string;
  provider?: string;
}

/** Espera cancelável: `AbortSignal` encurta o sono, nunca o deixa pendurado. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * P3 — precedência do modelo: escolha explícita da tela > `nextTurnModel` (consumido e
 * apagado) > `defaultModel` da extensão > preferência. O último degrau é aplicado dentro de
 * `createRun()`, que já lê as preferências; aqui só resolvemos os dois do LocalStorage.
 */
async function resolveModelChoice(model?: string, provider?: string): Promise<ModelChoice> {
  if (model !== undefined || provider !== undefined) return { model, provider };

  const nextTurn = await readJson<ModelChoice>(StorageKeys.nextTurnModel);
  if (nextTurn && (nextTurn.model !== undefined || nextTurn.provider !== undefined)) {
    await writeJson(StorageKeys.nextTurnModel, undefined);
    return nextTurn;
  }
  return (await readJson<ModelChoice>(StorageKeys.defaultModel)) ?? {};
}

/**
 * Armadilha 19: `waiting_for_approval` gruda no `GET /v1/runs/{id}` mesmo depois de a
 * aprovação ter sido respondida em outro aplicativo. Quando o último evento já não é o
 * pedido, o que vale é o evento — o run está andando.
 */
function effectiveStatus(run: Run): RunStatus {
  if (run.status === "waiting_for_approval" && run.last_event !== undefined && run.last_event !== "approval.request") {
    return "running";
  }
  return run.status;
}

/** §4.4: eventos do stream vencem qualquer outra fonte. */
function statusFromEvent(previous: RunStatus, eventName: string): RunStatus {
  // `stopping` só sai por um desfecho real (§6.6.3): um delta atrasado não o desfaz.
  if (previous === "stopping" && !eventName.startsWith("run.")) return previous;
  switch (eventName) {
    case "approval.request":
      return "waiting_for_approval";
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    case "run.cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function seconds(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

export function useRunStream(request: AskRequest): RunStreamController {
  const [state, setState] = useState<RunStreamState>({
    status: "queued",
    text: "",
    steps: [],
    expired: false,
    stopRequested: false,
    liveStream: false,
    thinking: false,
    newConversation: request.sessionId === undefined,
    sessionId: request.sessionId,
    sessionTitle: request.sessionTitle,
    startedAt: Date.now(),
  });

  /** Reentrada do acompanhamento (reassinar / passar a consultar), sem recriar a run. */
  const [follow, setFollow] = useState<{ token: number; mode: FollowMode }>({ token: 0, mode: "stream" });
  /** `Tentar novamente` — aí sim uma execução nova. */
  const [attempt, setAttempt] = useState(0);

  const mountedRef = useRef(true);
  /** Promessa ÚNICA de criação: o duplo-invoke do StrictMode não pode criar duas runs. */
  const startRef = useRef<Promise<StartedRun> | undefined>(undefined);
  const runIdRef = useRef<string | undefined>(undefined);
  const sessionIdRef = useRef<string | undefined>(request.sessionId);
  const approvalsPendingRef = useRef(0);
  const streamingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { streamResponses } = getHermesPreferences();

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let pushedText = false;

    const alive = (): boolean => mountedRef.current && !cancelled;
    const patch = (fn: (previous: RunStreamState) => RunStreamState): void => {
      if (alive()) setState(fn);
    };

    // Cada `setState` atravessa a ponte IPC até o host WPF: agrupa em ~80 ms (armadilha 55).
    const buffer = createTextBuffer((text) => patch((s) => ({ ...s, text })), RENDER_BUFFER_MS);

    let thinkingTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      patch((s) => (s.text === "" && s.steps.length === 0 ? { ...s, thinking: true } : s));
    }, THINKING_AFTER_MS);

    const markProgress = (): void => {
      if (thinkingTimer !== undefined) {
        clearTimeout(thinkingTimer);
        thinkingTimer = undefined;
      }
    };

    async function persistTerminal(runId: string, status: RunStatus, output?: string, error?: string): Promise<void> {
      await updateStoredRun(runId, { lastKnownStatus: status, lastKnownEvent: `run.${status}` });
      await saveRunResult({ runId, status, output, error, savedAt: Date.now() });
    }

    /**
     * Cria (uma única vez) a conversa e a run. Sem `AbortSignal` de propósito: a desmontagem
     * não pode impedir o registro do `run_id`, senão a tarefa nasce órfã e o usuário perde o
     * resultado — não há rota que liste execuções.
     */
    async function createRunOnce(): Promise<StartedRun> {
      const choice = await resolveModelChoice(request.model, request.provider);
      const existing = request.sessionId ?? sessionIdRef.current;

      let runId: string;
      let sessionId: string | undefined = existing;
      let sessionTitle = request.sessionTitle;
      let isNew = false;

      if (existing !== undefined) {
        const created = await askInSession(existing, request.prompt, {
          model: choice.model,
          provider: choice.provider,
        });
        runId = created.run_id;
      } else {
        // D-01: sessão `source:"desktop"` + run amarrada a ela. `startConversation` já
        // desfaz a sessão se a run não for aceita (R4: conversa vazia é lixo invisível).
        const conversation = await startConversation({
          input: request.prompt,
          model: choice.model,
          provider: choice.provider,
        });
        runId = conversation.runId;
        sessionId = conversation.sessionId;
        sessionTitle = conversation.title;
        isNew = true;
      }

      runIdRef.current = runId;
      sessionIdRef.current = sessionId;

      const { baseUrl } = await resolveBaseUrl();
      await rememberRun({
        runId,
        sessionId,
        promptPreview: request.prompt.slice(0, PREVIEW_CHARS),
        createdAt: Date.now(),
        lastKnownStatus: "queued",
        baseUrl,
      });
      if (sessionId !== undefined) await writeJson(StorageKeys.lastSessionId, sessionId);

      return { runId, sessionId, sessionTitle, newConversation: isNew, baseUrl };
    }

    function applyApprovalRequest(runId: string, fields: ApprovalRequestFields): void {
      approvalsPendingRef.current += 1;
      const receivedAt = Date.now();
      // Persistir NA HORA: não existe rota que devolva um pedido de aprovação perdido.
      // `patternKey`, `patternKeys` e `smartDenied` são obrigatórios aqui: são eles que
      // decidem o bloco de risco da §7.3 e o ícone vermelho de `Execuções do Hermes`.
      // Sem eles, um `rm -rf` reaberto em outra tela viraria "⚠️ Ação sensível".
      void saveApprovalRequest({
        runId,
        command: fields.command,
        description: fields.description,
        choices: fields.choices ?? [],
        requestId: fields.request_id,
        patternKey: fields.pattern_key,
        patternKeys: fields.pattern_keys,
        smartDenied: fields.smart_denied,
        receivedAt,
      }).catch(() => undefined);

      patch((s) => ({
        ...s,
        status: "waiting_for_approval",
        approval: {
          fields,
          pendingCount: approvalsPendingRef.current,
          receivedAt,
          detailsLost: false,
        },
        steps: [...s.steps, "🔐 O Hermes pediu sua aprovação"],
      }));
    }

    const handlers: RunStreamHandlers = {
      onEvent: (event) => {
        markProgress();
        // Este handler recebe TODO evento, inclusive cada `message.delta`. Devolver o mesmo
        // objeto quando nada mudou faz o React desistir do re-render — sem isso haveria um
        // `setState` por token e o buffer de 80 ms não serviria de nada (armadilha 55).
        patch((s) => {
          const status = statusFromEvent(s.status, event.event);
          if (status === s.status && !s.thinking) return s;
          return { ...s, thinking: false, status };
        });
      },
      // §6.2: com "mostrar enquanto escreve" desligado, nada é pintado até o desfecho.
      onText: streamResponses
        ? (full) => {
            pushedText = true;
            buffer.push(full);
          }
        : undefined,
      onToolStarted: (tool, preview) => {
        patch((s) => ({
          ...s,
          activeTool: tool,
          steps: [...s.steps, preview ? `🔧 Usando ${tool} — ${preview}` : `🔧 Usando ${tool}`],
        }));
      },
      onToolCompleted: (tool, duration, failed) => {
        patch((s) => ({
          ...s,
          activeTool: undefined,
          steps: [
            ...s.steps,
            failed
              ? `⚠️ ${tool} falhou depois de ${seconds(duration)} s`
              : `✅ ${tool} concluído em ${seconds(duration)} s`,
          ],
        }));
      },
      onReasoning: (text) => {
        const short = text.length > 100 ? `${text.slice(0, 100)}…` : text;
        patch((s) => ({ ...s, steps: [...s.steps, `💭 ${short}`] }));
      },
      onSubagent: (event) => {
        const fields = event as unknown as { goal?: string; summary?: string };
        const line =
          event.event === "subagent.start"
            ? `👥 Tarefa auxiliar iniciada: ${fields.goal ?? "sem descrição"}`
            : `👥 Tarefa auxiliar concluída: ${fields.summary ?? "sem resumo"}`;
        patch((s) => ({ ...s, steps: [...s.steps, line] }));
      },
      onApprovalRequest: (fields) => {
        applyApprovalRequest(fields.run_id, fields);
      },
      onApprovalResponded: (choice, resolved) => {
        approvalsPendingRef.current = Math.max(0, approvalsPendingRef.current - Math.max(resolved, 1));
        const stillPending = approvalsPendingRef.current > 0;
        if (!stillPending && runIdRef.current !== undefined) {
          void clearApprovalRequest(runIdRef.current).catch(() => undefined);
        }
        patch((s) => ({
          ...s,
          approval:
            stillPending && s.approval ? { ...s.approval, pendingCount: approvalsPendingRef.current } : undefined,
          steps: [...s.steps, `🔐 Aprovação respondida: ${APPROVAL_CHOICE_LABEL[choice]}`],
        }));
      },
    };

    async function applyRun(run: Run): Promise<void> {
      const status = effectiveStatus(run);
      const terminal = isTerminalRunStatus(status);

      if (status === "waiting_for_approval" && approvalsPendingRef.current === 0) {
        // A janela pode ter sido fechada quando o pedido chegou: procuramos o payload
        // gravado; sem ele, a tela de aprovação entra no modo "detalhes perdidos" (§7.6).
        const stored = await loadApprovalRequest(run.run_id);
        approvalsPendingRef.current = 1;
        patch((s) => ({
          ...s,
          approval: {
            fields: {
              command: stored?.command,
              description: stored?.description,
              choices: (stored?.choices ?? ["deny"]) as ApprovalChoice[],
              request_id: stored?.requestId,
              // §7.3: sem estes três a tela reabre um comando destrutivo com o aviso
              // fraco ("Ação sensível") e sem o 🛑 de `smart_denied`.
              pattern_key: stored?.patternKey,
              pattern_keys: stored?.patternKeys,
              smart_denied: stored?.smartDenied,
            },
            pendingCount: 1,
            receivedAt: stored?.receivedAt ?? Date.now(),
            detailsLost: stored === undefined,
          },
        }));
      }

      patch((s) => ({
        ...s,
        status,
        model: run.model ?? s.model,
        usage: run.usage ?? s.usage,
        pendingSteer: run.pending_steer ?? s.pendingSteer,
        text: run.output !== undefined && run.output !== "" ? run.output : s.text,
        approval: status === "waiting_for_approval" ? s.approval : undefined,
        finishedAt: terminal ? (s.finishedAt ?? Date.now()) : s.finishedAt,
      }));

      if (terminal) {
        if (run.output !== undefined) buffer.cancel();
        await persistTerminal(run.run_id, status, run.output, run.error);
      } else {
        await updateStoredRun(run.run_id, { lastKnownStatus: status, lastKnownEvent: run.last_event, expired: false });
      }
    }

    /** Acompanha por SSE. Devolve `terminal` (acabou), `poll` (descobrir consultando) ou `halt`. */
    async function followStream(runId: string): Promise<"terminal" | "poll" | "halt"> {
      streamingRef.current = true;
      patch((s) => ({ ...s, liveStream: true, streamFailure: undefined }));
      try {
        // Assinar imediatamente: a fila do servidor é destruída após 300 s sem assinante.
        const response = await openRunEventStream(runId, controller.signal);
        const result = await consumeRunEventStream(response, runId, handlers, controller.signal);
        if (pushedText) buffer.flush();
        if (result.aborted || !alive()) return "halt";

        if (result.terminalEvent === "run.completed") {
          markProgress();
          // §6.2: o texto final é o `output`; substitui o acúmulo de deltas para não divergir.
          const output = result.output ?? result.text;
          patch((s) => ({
            ...s,
            status: "completed",
            text: output,
            usage: result.usage ?? s.usage,
            pendingSteer: result.pendingSteer,
            activeTool: undefined,
            thinking: false,
            finishedAt: Date.now(),
          }));
          await persistTerminal(runId, "completed", output);
          return "terminal";
        }

        if (result.terminalEvent === "run.failed") {
          patch((s) => ({
            ...s,
            status: "failed",
            activeTool: undefined,
            thinking: false,
            finishedAt: Date.now(),
            // E21 — o texto do evento já vem redigido pelo servidor.
            streamFailure: {
              message: `O Hermes não conseguiu concluir: ${result.error ?? "sem detalhes"}`,
              canReattach: false,
              technical: `run.failed em ${runId}: ${result.error ?? "-"}`,
            },
          }));
          await persistTerminal(runId, "failed", result.text, result.error);
          return "terminal";
        }

        if (result.terminalEvent === "run.cancelled") {
          patch((s) => ({
            ...s,
            status: "cancelled",
            activeTool: undefined,
            thinking: false,
            finishedAt: Date.now(),
          }));
          await persistTerminal(runId, "cancelled", result.text);
          return "terminal";
        }

        // `: stream closed` sem desfecho: o servidor sabe o que aconteceu, nós não.
        return "poll";
      } catch (err) {
        if (isAbort(err) || !alive()) return "halt";
        const hermes = toHermesError(err, `GET /v1/runs/${runId}/events`);

        if (hermes.uxId === "E9") {
          // 404 ao assinar: o acompanhamento ao vivo se perdeu, a tarefa continua rodando.
          patch((s) => ({
            ...s,
            streamFailure: { message: hermes.userMessage, canReattach: false, technical: hermes.technical },
          }));
          return "poll";
        }

        if (!alive()) return "halt";
        patch((s) => ({
          ...s,
          // E23 — literal da UX-SPEC §5.2.
          streamFailure: {
            message: "A conexão com o Hermes caiu no meio da resposta. A tarefa continua rodando no Hermes.",
            canReattach: true,
            technical: hermes.technical,
          },
        }));
        // `poll`, não `halt`: a regra do cabeçalho ("a recuperação é consulta a
        // `GET /v1/runs/{id}` a cada 2 s") vale para QUALQUER queda do stream. Parar aqui
        // deixava a barra de progresso girando para sempre com o texto congelado, e a
        // única saída era `Acompanhar de novo` — que reassina e toma 404 (armadilha 14)
        // antes de finalmente cair no polling. A ação E23 continua oferecida.
        return "poll";
      } finally {
        streamingRef.current = false;
        patch((s) => ({ ...s, liveStream: false }));
      }
    }

    /** Acompanhamento sem stream: consulta a cada 2 s até o estado terminal (§6.5 item 4). */
    async function followPolling(runId: string): Promise<void> {
      for (;;) {
        if (!alive() || controller.signal.aborted) return;
        try {
          const run = await reconcileRun(runId, controller.signal);
          // Um ciclo que deu certo apaga o aviso do ciclo que falhou. Sem isto o banner de
          // rede ficaria na tela para sempre depois de uma falha passageira já superada.
          // Devolver o mesmo objeto quando não há aviso evita um re-render inútil por poll.
          patch((s) => (s.streamFailure === undefined ? s : { ...s, streamFailure: undefined }));
          if (run === "expired") {
            // 404 = expirada. NUNCA "Falhou" (§4.3). Gravar no índice: sem isso o
            // `lastKnownStatus` fica em `running` por até 7 dias e o banner
            // "Você tem N tarefas em andamento" mente sobre uma execução que sumiu.
            await updateStoredRun(runId, { expired: true });
            patch((s) => ({ ...s, expired: true, thinking: false }));
            return;
          }
          await applyRun(run);
          if (isTerminalRunStatus(effectiveStatus(run))) return;
        } catch (err) {
          if (isAbort(err) || !alive()) return;
          const hermes = toHermesError(err, `GET /v1/runs/${runId}`);
          patch((s) => ({
            ...s,
            streamFailure: { message: hermes.userMessage, canReattach: true, technical: hermes.technical },
          }));
          // Deliberadamente SEM `return`: uma falha de rede passageira não pode encerrar o
          // acompanhamento. Encerrar aqui deixava o status preso em `running` e a barra de
          // carregamento girando para sempre, porque nada mais consultava o servidor.
          // `run-progress.tsx` já reagenda o ciclo no `finally`; a simetria aqui é cair no
          // `sleep` abaixo e tentar de novo. O aviso na tela é apagado no primeiro ciclo
          // que voltar a dar certo.
        }
        await sleep(POLL_INTERVAL_MS, controller.signal);
      }
    }

    void (async () => {
      try {
        if (startRef.current === undefined) startRef.current = createRunOnce();
        const started = await startRef.current;
        if (!alive()) return;

        patch((s) => ({
          ...s,
          runId: started.runId,
          sessionId: started.sessionId ?? s.sessionId,
          sessionTitle: started.sessionTitle ?? s.sessionTitle,
          newConversation: started.newConversation,
          baseUrl: started.baseUrl,
        }));

        const outcome = follow.mode === "stream" ? await followStream(started.runId) : "poll";
        if (outcome === "terminal" || outcome === "halt") return;
        await followPolling(started.runId);
      } catch (err) {
        if (isAbort(err) || !alive()) return;
        // Falha antes de existir qualquer texto: é a tela inteira (§5.3).
        const hermes = toHermesError(err, "POST /v1/runs");
        patch((s) => ({ ...s, fatalError: hermes, thinking: false }));
      }
    })();

    return () => {
      cancelled = true;
      buffer.cancel();
      if (thinkingTimer !== undefined) clearTimeout(thinkingTimer);
      // ÚNICO cancelamento da desmontagem: o leitor local. A run continua no Hermes (D-02);
      // `stopRun()` nunca é chamado aqui.
      controller.abort();
    };
    // Dependências deliberadas: `request.*` definem a pergunta; `follow` e `attempt` só
    // reentram no acompanhamento (a run já criada é reaproveitada por `startRef`). Os
    // handlers e os setters ficam de fora de propósito — entrariam em loop de re-render.
  }, [request.prompt, request.sessionId, request.model, request.provider, follow, attempt, streamResponses]);

  const stop = useCallback(async (): Promise<void> => {
    // A ação `Parar` já está visível no primeiro quadro, porque o estado inicial é `queued`
    // (§4.1) — mas `runIdRef` só é preenchido depois que a criação da run volta do servidor.
    // Sair aqui por `runId === undefined` fazia de `Parar` um no-op silencioso justamente na
    // janela em que o usuário mais tenta parar: logo depois de enviar. `startRef` guarda a
    // promessa ÚNICA de criação, então dá para esperar por ela e parar de verdade.
    const pending = startRef.current;
    if (runIdRef.current === undefined && pending === undefined) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Parando a tarefa…" });
    setState((s) => ({
      ...s,
      stopRequested: true,
      status: isTerminalRunStatus(s.status) ? s.status : "stopping",
    }));

    let runId = runIdRef.current;
    if (runId === undefined && pending !== undefined) {
      try {
        runId = (await pending).runId;
      } catch {
        // A criação falhou por conta própria; o efeito já publica esse erro na tela.
        // Não há execução para parar, e um segundo aviso só confundiria.
        toast.hide();
        setState((s) => ({ ...s, stopRequested: false }));
        return;
      }
    }
    if (runId === undefined) {
      toast.hide();
      setState((s) => ({ ...s, stopRequested: false }));
      return;
    }

    try {
      await stopRun(runId);
      toast.style = Toast.Style.Success;
      toast.title = "Tarefa parada";
    } catch (err) {
      const hermes = toHermesError(err, `POST /v1/runs/${runId}/stop`);
      if (hermes.httpStatus === 404) {
        // A run já tinha terminado: isso não é erro (§6.6 item 4).
        toast.style = Toast.Style.Success;
        toast.title = "Tarefa parada";
        setState((s) => ({ ...s, status: isTerminalRunStatus(s.status) ? s.status : "cancelled" }));
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = hermes.userMessage;
      }
    }

    // Sem stream vivo não chega `run.cancelled`: volta a consultar até ver o desfecho.
    if (!streamingRef.current) setFollow((f) => ({ token: f.token + 1, mode: "poll" }));
  }, []);

  const steer = useCallback(async (text: string): Promise<void> => {
    const runId = runIdRef.current;
    if (runId === undefined) return;
    try {
      await steerRun(runId, text);
      setState((s) => ({ ...s, steps: [...s.steps, "🧭 Orientação enviada"] }));
      await showHUD("Orientação enviada");
    } catch (err) {
      const hermes = toHermesError(err, `POST /v1/runs/${runId}/steer`);
      await showToast({ style: Toast.Style.Failure, title: hermes.userMessage });
    }
  }, []);

  const reattach = useCallback(() => {
    setFollow((f) => ({ token: f.token + 1, mode: "stream" }));
  }, []);

  const retry = useCallback(() => {
    startRef.current = undefined;
    runIdRef.current = undefined;
    approvalsPendingRef.current = 0;
    setState((s) => ({
      status: "queued",
      text: "",
      steps: [],
      expired: false,
      stopRequested: false,
      liveStream: false,
      thinking: false,
      newConversation: false,
      sessionId: sessionIdRef.current,
      sessionTitle: s.sessionTitle,
      baseUrl: s.baseUrl,
      startedAt: Date.now(),
    }));
    setFollow({ token: 0, mode: "stream" });
    setAttempt((a) => a + 1);
  }, []);

  const approvalResolved = useCallback((resolved: number) => {
    approvalsPendingRef.current = Math.max(0, approvalsPendingRef.current - Math.max(resolved, 1));
    const stillPending = approvalsPendingRef.current > 0;
    if (!stillPending && runIdRef.current !== undefined) {
      void clearApprovalRequest(runIdRef.current).catch(() => undefined);
    }
    setState((s) => ({
      ...s,
      status: s.status === "waiting_for_approval" ? "running" : s.status,
      approval: stillPending && s.approval ? { ...s.approval, pendingCount: approvalsPendingRef.current } : undefined,
    }));
  }, []);

  return { state, stop, steer, reattach, retry, approvalResolved };
}
