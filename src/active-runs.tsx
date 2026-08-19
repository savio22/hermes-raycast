/* eslint-disable @raycast/prefer-title-case -- a UX-SPEC §10.1 exige título de ação em
   frase, em pt-BR ("Copiar resposta", nunca "Copiar Resposta"); a regra é calibrada para o
   Title Case do inglês e `ray lint --fix` reescreve a copy do produto sem ela. */

/**
 * `Execuções do Hermes` (UX-SPEC §2.5).
 *
 * NÃO EXISTE `GET /v1/runs` no servidor (armadilha 42, verificado). Esta lista é 100% local:
 * ela nasce do índice de execuções gravado em `LocalStorage` por quem disparou a tarefa e é
 * revalidada com `GET /v1/runs/{run_id}`, uma requisição por execução.
 *
 * As três regras que essa arquitetura impõe:
 * 1. um `run_id` que devolve 404 significa "o gateway reiniciou ou passou o TTL de 1 h" —
 *    isso é a CONDIÇÃO `Execução expirada` (§4.3), nunca o estado `Falhou` nem `Cancelado`;
 * 2. o polling de 2 s só corre enquanto houver execução não terminal, no máximo 10 por ciclo,
 *    e nunca reconsulta uma execução já terminal (§2.5, §8.5);
 * 3. `Remover da lista` apaga apenas o registro local; nada é apagado no Hermes, e o título
 *    da ação diz isso em voz alta.
 */

import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  Icon,
  LaunchType,
  List,
  Toast,
  confirmAlert,
  launchCommand,
  openExtensionPreferences,
  showHUD,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { ApprovalView, isDestructive } from "./components/approval-view";
import { NotConfigured } from "./components/first-run";
import {
  RUN_POLL_MS,
  RunProgressView,
  approvalFields,
  effectiveRunStatus,
  readRunOutput,
  shorten,
  statusImage,
  technicalDetails,
} from "./components/run-progress";
import { SteerForm, steerAndReport } from "./components/steer-form";
import { SHORTCUTS } from "./components/shortcuts";
import { hermesDesktopSessionUrl } from "./lib/discovery";
import { HermesError, isAbort, toHermesError } from "./lib/errors";
import { getSession, reconcileRun, stopRun } from "./lib/hermes-api";
import { isConfigured } from "./lib/preferences";
import {
  RUN_EXPIRED,
  isTerminalRunStatus,
  runStatusAppearance,
  runStatusLabel,
  type StatusAppearance,
} from "./lib/status";
import {
  forgetRun,
  listStoredRuns,
  loadApprovalRequest,
  pruneLocalData,
  updateStoredRuns,
  type StoredApproval,
  type StoredRun,
} from "./lib/storage";
import type { Run } from "./lib/types";

/** UX-SPEC §2.5: teto de requisições por ciclo de polling. */
const MAX_REQUESTS_PER_CYCLE = 10;

/* ═══════════════════════════ Modelo de linha da lista ═══════════════════════════ */

/**
 * O que a lista sabe de uma execução: o registro local (sempre) mais o que o servidor
 * respondeu no último ciclo (quando respondeu).
 */
interface RunRow {
  stored: StoredRun;
  /** Resposta viva do servidor; `undefined` enquanto o primeiro ciclo não terminou. */
  live?: Run;
  /** `GET /v1/runs/{id}` devolveu 404. */
  expired: boolean;
  approval?: StoredApproval;
  sessionTitle?: string;
}

/**
 * Estado exibido de uma linha.
 *
 * A regra do 404 tem uma exceção deliberada e ela NÃO viola a §4.3: quando o próprio Raycast
 * acompanhou a execução até o fim, o desfecho ficou gravado em `lastKnownStatus` e o texto
 * do resultado em `runResult`. Nesse caso o 404 não é "não sei o que aconteceu" — é só o
 * servidor tendo descartado o registro de uma tarefa que nós vimos terminar, e continuar
 * mostrando "Concluído" com o resultado reabrível é a verdade. `Execução expirada` fica para
 * o caso em que realmente não sabemos: 404 sem desfecho observado.
 */
function displayStatus(row: RunRow): { label: string; appearance: StatusAppearance; expired: boolean } {
  if (!row.expired) {
    const status = effectiveStatus(row);
    return { label: runStatusLabel(status), appearance: runStatusAppearance(status), expired: false };
  }
  if (isTerminalRunStatus(row.stored.lastKnownStatus)) {
    const status = row.stored.lastKnownStatus;
    return { label: runStatusLabel(status), appearance: runStatusAppearance(status), expired: false };
  }
  return { label: RUN_EXPIRED.label, appearance: RUN_EXPIRED, expired: true };
}

/**
 * Armadilha 19: `waiting_for_approval` gruda no `GET /v1/runs/{id}` depois de a aprovação
 * ter sido respondida em outro aplicativo (o Hermes Desktop, tipicamente). O desempate é o
 * `last_event` — sem ele a linha ficava presa em "Precisa de você" para sempre e
 * `Responder pedido de aprovação` devolvia E12 a cada tentativa.
 */
function effectiveStatus(row: RunRow): string {
  return row.live === undefined ? row.stored.lastKnownStatus : effectiveRunStatus(row.live);
}

function isRowTerminal(row: RunRow): boolean {
  return row.expired || isTerminalRunStatus(effectiveStatus(row));
}

type SectionId = "aprovacao" | "andamento" | "concluidas" | "encerradas";

const SECTION_TITLE: Record<SectionId, string> = {
  aprovacao: "Precisa de você",
  andamento: "Em andamento",
  concluidas: "Concluídas",
  encerradas: "Encerradas",
};

function sectionOf(row: RunRow): SectionId {
  const { expired } = displayStatus(row);
  if (expired) return "encerradas";
  const status = effectiveStatus(row);
  if (status === "waiting_for_approval") return "aprovacao";
  if (status === "completed") return "concluidas";
  if (isTerminalRunStatus(status)) return "encerradas";
  return "andamento";
}

/* ══════════════════════════════════ Comando ══════════════════════════════════ */

export default function Command(): ReactElement {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  const [rows, setRows] = useState<RunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<HermesError | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  /** Títulos já resolvidos, para não repetir `GET /api/sessions/{id}` a cada ciclo. */
  const titles = useRef(new Map<string, string>());
  /**
   * Espelho de `rows` para o ciclo de polling. Sem ele o `cycle()` leria o array capturado
   * quando o efeito montou e continuaria consultando execuções que JÁ viraram terminais —
   * exatamente a rajada que a §8.5 manda evitar.
   */
  const rowsRef = useRef<RunRow[]>([]);
  rowsRef.current = rows;
  const hasRows = rows.length > 0;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void isConfigured().then((value) => {
      if (!cancelled) setConfigured(value);
    });
    return () => {
      cancelled = true;
    };
    // `nonce`: `NotConfigured` chama `refresh` quando a detecção automática termina. Com
    // `[]` aqui a tela de primeiro uso virava beco sem saída — `configured` continuava
    // `false` até o usuário fechar e reabrir o comando.
  }, [nonce]);

  /* ── Carga inicial: poda os dados vencidos e monta a lista a partir do índice local ── */
  useEffect(() => {
    if (configured !== true) return;
    let cancelled = false;

    void (async () => {
      // UX-SPEC §8.7: a poda de aprovações e resultados acontece ao abrir esta tela.
      await pruneLocalData();
      const stored = await listStoredRuns();
      if (cancelled) return;
      setRows(
        stored
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          // `expired` vem do índice: o 404 é permanente (o servidor descartou o registro),
          // então reconsultá-lo a cada abertura só queima requisições do teto da §2.5.
          .map((run) => ({
            stored: run,
            expired: run.expired === true,
            sessionTitle: titles.current.get(run.sessionId ?? ""),
          })),
      );
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [configured, nonce]);

  /* ── Revalidação: um GET por execução, 2 s de cadência, só em primeiro plano ── */
  useEffect(() => {
    if (configured !== true || !hasRows) return;

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** No primeiro ciclo tudo é consultado; depois, só o que ainda pode mudar. */
    let firstCycle = true;
    /** §5.3: só o PRIMEIRO erro de uma sequência vira Toast (a guarda de `sessions.tsx`). */
    let pollFailing = false;

    const cycle = async (): Promise<void> => {
      const current = rowsRef.current;
      // O teto da §2.5 ("cada ciclo faz no máximo 10 requisições") vale também na abertura:
      // com o índice cheio, isentar o primeiro ciclo disparava 20 GETs de uma vez.
      const targets = current.filter((row) => firstCycle || !isRowTerminal(row)).slice(0, MAX_REQUESTS_PER_CYCLE);

      if (targets.length === 0) return; // tudo terminal: o polling para de vez (§8.5)

      try {
        // `allSettled`, não `all`: com `all`, UMA execução respondendo 500 descartava as
        // outras 9 respostas boas e nenhuma linha era atualizada naquele ciclo.
        const settled = await Promise.allSettled(
          targets.map(async (row) => {
            const outcome = await reconcileRun(row.stored.runId, controller.signal);
            return { runId: row.stored.runId, outcome };
          }),
        );
        if (cancelled) return;

        const byId = new Map<string, Run | "expired">();
        let failure: unknown;
        for (const result of settled) {
          if (result.status === "fulfilled") byId.set(result.value.runId, result.value.outcome);
          else if (!isAbort(result.reason)) failure ??= result.reason;
        }

        // UMA gravação por ciclo: `updateStoredRun` é read-modify-write sobre a mesma
        // chave, e N chamadas concorrentes se sobrescrevem (a última apaga as demais).
        const patches = new Map<string, Partial<StoredRun>>();
        for (const [runId, outcome] of byId) {
          patches.set(
            runId,
            outcome === "expired"
              ? { expired: true }
              : { lastKnownStatus: outcome.status, lastKnownEvent: outcome.last_event, expired: false },
          );
        }
        void updateStoredRuns(patches).catch(() => undefined);

        setRows((rows) =>
          rows.map((row) => {
            const outcome = byId.get(row.stored.runId);
            if (outcome === undefined) return row;
            if (outcome === "expired") return { ...row, expired: true };
            return { ...row, live: outcome, expired: false };
          }),
        );

        if (failure === undefined) {
          pollFailing = false;
          setError(undefined);
        } else if (!pollFailing) {
          // Sem esta guarda o Hermes fora do ar produzia um Toast vermelho a cada 2 s,
          // para sempre: `toHermesError` devolve um objeto NOVO por ciclo e o efeito do
          // Toast depende da identidade de `error`.
          pollFailing = true;
          setError(toHermesError(failure, "active-runs"));
        }
      } finally {
        firstCycle = false;
        if (!cancelled) timer = setTimeout(() => void cycle(), RUN_POLL_MS);
      }
    };

    void cycle();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
    // `hasRows` e não `rows`: reagir a cada mudança de conteúdo reiniciaria o ciclo a cada
    // resposta. O conteúdo fresco entra por `rowsRef`, não pelas dependências.
  }, [configured, hasRows, nonce]);

  /**
   * Assinatura estável das linhas: só muda quando entra/sai uma execução ou quando um
   * estado muda. Sem ela o efeito de complementos rodaria a cada ciclo de polling.
   */
  const rowsSignature = rows.map((row) => `${row.stored.runId}:${effectiveStatus(row)}`).join("|");

  /* ── Complementos por linha: título da conversa e aprovação pendente gravada ── */
  useEffect(() => {
    if (configured !== true) return;
    let cancelled = false;

    void (async () => {
      for (const row of rowsRef.current) {
        if (cancelled) return;

        if (effectiveStatus(row) === "waiting_for_approval" && row.approval === undefined) {
          const approval = await loadApprovalRequest(row.stored.runId);
          if (cancelled) return;
          if (approval !== undefined) {
            setRows((current) =>
              current.map((item) => (item.stored.runId === row.stored.runId ? { ...item, approval } : item)),
            );
          }
        }

        const sessionId = row.stored.sessionId;
        if (sessionId === undefined || row.sessionTitle !== undefined || titles.current.has(sessionId)) continue;
        try {
          const envelope = await getSession(sessionId);
          const title = envelope.session.title ?? "Sem título";
          titles.current.set(sessionId, title);
          if (cancelled) return;
          setRows((current) =>
            current.map((item) => (item.stored.sessionId === sessionId ? { ...item, sessionTitle: title } : item)),
          );
        } catch {
          // Conversa apagada no Desktop ou Hermes fora: o item vive sem subtítulo.
          titles.current.set(sessionId, "Sem título");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configured, rowsSignature]);

  /**
   * UX-SPEC §5.3: com a lista já pintada, um erro de revalidação vira Toast em vez de tomar
   * a tela. O motivo é próprio desta lista: as linhas são dados LOCAIS que continuam válidos
   * com o Hermes fora do ar, e apagá-las tiraria do usuário justamente `Remover da lista` e
   * `Copiar resultado`, que funcionam offline. Sem nenhuma linha, o erro vai para a
   * `EmptyView`, como a spec pede.
   */
  useEffect(() => {
    if (error === undefined || !hasRows) return;
    const needsPreferences = error.recovery === "open_preferences";
    void showToast({
      style: Toast.Style.Failure,
      title: error.userMessage,
      primaryAction: {
        title: needsPreferences ? "Abrir configurações" : "Tentar novamente",
        onAction: (toast) => {
          if (needsPreferences) void openExtensionPreferences();
          else refresh();
          void toast.hide();
        },
      },
    });
  }, [error, hasRows, refresh]);

  /* ── Ações ── */

  async function handleStop(row: RunRow): Promise<void> {
    // Sem `confirmAlert` (UX-SPEC §6.6 item 6): parar não destrói nada e a confirmação
    // atrasaria a única saída de emergência do usuário.
    const toast = await showToast({ style: Toast.Style.Animated, title: "Parando a tarefa…" });
    try {
      await stopRun(row.stored.runId);
      toast.style = Toast.Style.Success;
      toast.title = "Tarefa parada";
    } catch (err) {
      const stopError = toHermesError(err, "stopRun");
      // Armadilha 21: 404 significa "já tinha terminado", nunca erro.
      if (stopError.httpStatus === 404) {
        toast.style = Toast.Style.Success;
        toast.title = "Tarefa parada";
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = stopError.userMessage;
      }
    } finally {
      refresh();
    }
  }

  async function handleForget(row: RunRow): Promise<void> {
    await forgetRun(row.stored.runId);
    setRows((current) => current.filter((item) => item.stored.runId !== row.stored.runId));
    await showToast({ style: Toast.Style.Success, title: "Removida da lista" });
  }

  async function handleClearFinished(): Promise<void> {
    const finished = rows.filter((row) => isRowTerminal(row));
    if (finished.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "Não há execuções encerradas para limpar." });
      return;
    }
    const confirmed = await confirmAlert({
      icon: Icon.Trash,
      title: "Limpar as execuções encerradas?",
      message: `${finished.length} ${finished.length === 1 ? "execução sai" : "execuções saem"} desta lista. Nada é apagado no Hermes.`,
      primaryAction: { title: "Limpar", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
      rememberUserChoice: false,
    });
    if (!confirmed) return;

    for (const row of finished) await forgetRun(row.stored.runId);
    setRows((current) => current.filter((row) => !isRowTerminal(row)));
    await showToast({ style: Toast.Style.Success, title: "Lista limpa" });
  }

  async function handleCopyResult(row: RunRow): Promise<void> {
    const output = await readRunOutput(row.stored.runId);
    if (output === undefined || output === "") {
      await showToast({ style: Toast.Style.Failure, title: "Esta tarefa não deixou um resultado para copiar." });
      return;
    }
    await Clipboard.copy(output);
    await showHUD("Resposta copiada");
  }

  // Guarda de configuração da UX-SPEC §2: sem chave, nenhuma requisição sai daqui.
  if (configured === false) return <NotConfigured commandTitle="Execuções do Hermes" onRetry={refresh} />;

  const sections: SectionId[] = ["aprovacao", "andamento", "concluidas", "encerradas"];
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <List
      navigationTitle="Execuções do Hermes"
      isLoading={isLoading || configured === undefined}
      searchBarPlaceholder="Pesquisar por texto da tarefa"
    >
      {showEmpty && error !== undefined && (
        // UX-SPEC §5.3: erro que impede a tela inteira vira `List.EmptyView` numa `List`.
        <List.EmptyView
          icon={{ source: Icon.WifiDisabled, tintColor: Color.Red }}
          title={error.userMessage}
          actions={
            <ActionPanel>
              <Action
                title="Tentar novamente"
                icon={Icon.ArrowClockwise}
                shortcut={SHORTCUTS.refresh}
                onAction={refresh}
              />
              <Action
                title="Abrir configurações"
                icon={Icon.Gear}
                shortcut={SHORTCUTS.preferences}
                onAction={openExtensionPreferences}
              />
              <Action.CopyToClipboard
                title="Copiar detalhes técnicos"
                content={technicalDetails({ runId: "—", error })}
                shortcut={SHORTCUTS.copyTechnical}
              />
            </ActionPanel>
          }
        />
      )}

      {showEmpty && error === undefined && (
        <List.EmptyView
          icon={Icon.Clock}
          title="Nenhuma execução recente"
          description="Quando você pedir uma tarefa ao Hermes, ela aparece aqui até você limpar."
          actions={
            <ActionPanel>
              <Action
                title="Executar tarefa no Hermes"
                icon={Icon.Play}
                onAction={() => void launchCommand({ name: "run-task", type: LaunchType.UserInitiated })}
              />
              <Action title="Atualizar" icon={Icon.ArrowClockwise} shortcut={SHORTCUTS.refresh} onAction={refresh} />
            </ActionPanel>
          }
        />
      )}

      {sections.map((section) => {
        const items = rows.filter((row) => sectionOf(row) === section);
        if (items.length === 0) return null;
        return (
          <List.Section key={section} title={SECTION_TITLE[section]} subtitle={String(items.length)}>
            {items.map((row) => (
              <RunListItem
                key={row.stored.runId}
                row={row}
                onRefresh={refresh}
                onStop={() => void handleStop(row)}
                onForget={() => void handleForget(row)}
                onClearFinished={() => void handleClearFinished()}
                onCopyResult={() => void handleCopyResult(row)}
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}

/* ═══════════════════════════════ Item da lista ═══════════════════════════════ */

function RunListItem(props: {
  row: RunRow;
  onRefresh: () => void;
  onStop: () => void;
  onForget: () => void;
  onClearFinished: () => void;
  onCopyResult: () => void;
}): ReactElement {
  const { row } = props;
  const { push } = useNavigation();
  const { label, appearance, expired } = displayStatus(row);
  const status = effectiveStatus(row);
  const terminal = isRowTerminal(row);
  const desktopUrl = hermesDesktopSessionUrl(row.stored.sessionId);
  const prompt = row.stored.promptPreview;

  const waitingApproval = !expired && status === "waiting_for_approval";
  // §7.3: item aguardando aprovação de um padrão destrutivo ganha marcação vermelha.
  const dangerous = waitingApproval && isDestructive(row.approval?.patternKeys ?? []);

  const stepsView = (
    <RunProgressView
      runId={row.stored.runId}
      prompt={prompt}
      sessionId={row.stored.sessionId}
      sessionTitle={row.sessionTitle}
      model={row.live?.model}
      createdAt={row.stored.createdAt}
      status={effectiveStatus(row)}
      attachStream={false}
      initialMode="etapas"
    />
  );

  const progressView = (
    <RunProgressView
      runId={row.stored.runId}
      prompt={prompt}
      sessionId={row.stored.sessionId}
      sessionTitle={row.sessionTitle}
      model={row.live?.model}
      createdAt={row.stored.createdAt}
      // O desfecho já conhecido, para a tela não abrir em `Estado: Desconhecido` — e para
      // que um 404 sobre uma execução que NÓS vimos terminar continue dizendo `Concluído`,
      // igual à linha da lista, em vez de `Execução expirada` um Enter depois.
      status={effectiveStatus(row)}
      // Armadilha 14: o stream de eventos não é retomável. Reabrir acompanha por polling.
      attachStream={false}
    />
  );

  return (
    <List.Item
      title={shorten(prompt, 60)}
      subtitle={row.sessionTitle}
      keywords={[label]}
      icon={
        dangerous
          ? { source: Icon.ExclamationMark, tintColor: Color.Red } // UX-SPEC §7.3
          : statusImage(appearance)
      }
      accessories={[
        { tag: { value: label, color: statusImage(appearance).tintColor } },
        { date: new Date(row.stored.createdAt) },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {waitingApproval && (
              <Action.Push
                title="Responder pedido de aprovação"
                icon={Icon.Lock}
                target={
                  <ApprovalView
                    runId={row.stored.runId}
                    fields={approvalFields(row.approval)}
                    pendingCount={1}
                    // §7.6: sem payload gravado, a tela oferece só `Negar`.
                    detailsLost={row.approval === undefined}
                    taskPreview={shorten(prompt, 60)}
                    conversationTitle={row.sessionTitle ?? "Sem título"}
                    sessionId={row.stored.sessionId}
                    onResolved={props.onRefresh}
                    // §7.4 `Ver etapas da tarefa`: aqui a aprovação foi aberta a partir da
                    // LISTA, então as etapas são uma tela nova, empilhada por cima.
                    onShowSteps={() => push(stepsView)}
                  />
                }
              />
            )}
            <Action.Push title="Ver execução" icon={Icon.Sidebar} target={progressView} />
            {status === "completed" && (
              <Action
                title="Copiar resultado"
                icon={Icon.Clipboard}
                shortcut={SHORTCUTS.copy}
                onAction={props.onCopyResult}
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
                title="Parar execução"
                icon={Icon.Stop}
                style={Action.Style.Destructive}
                shortcut={SHORTCUTS.stop}
                onAction={props.onStop}
              />
            )}
            {status === "running" && !expired && (
              // Armadilha 22: fora de `running` o servidor recusa a orientação com 409.
              <Action.Push
                title="Orientar execução"
                icon={Icon.Compass}
                shortcut={SHORTCUTS.steer}
                target={
                  <SteerForm
                    onSend={async (text) => {
                      await steerAndReport(row.stored.runId, text);
                      props.onRefresh();
                    }}
                  />
                }
              />
            )}
            <Action
              title="Perguntar de novo"
              icon={Icon.Repeat}
              shortcut={SHORTCUTS.newConversation}
              onAction={() =>
                void launchCommand({
                  name: "run-task",
                  type: LaunchType.UserInitiated,
                  arguments: { tarefa: prompt },
                })
              }
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            {terminal && (
              // Sem `confirmAlert`: não é destrutivo no servidor. O título diz isso.
              <Action
                title="Remover da lista (não apaga nada no Hermes)"
                icon={Icon.MinusCircle}
                shortcut={SHORTCUTS.remove}
                onAction={props.onForget}
              />
            )}
            <Action
              title="Limpar execuções encerradas"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={props.onClearFinished}
            />
            <Action
              title="Atualizar"
              icon={Icon.ArrowClockwise}
              shortcut={SHORTCUTS.refresh}
              onAction={props.onRefresh}
            />
            <Action.CopyToClipboard
              title="Copiar detalhes técnicos"
              content={technicalDetails({
                runId: row.stored.runId,
                sessionId: row.stored.sessionId,
                status: expired ? "run_not_found" : status,
                lastEvent: row.live?.last_event ?? row.stored.lastKnownEvent,
              })}
              shortcut={SHORTCUTS.copyTechnical}
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
