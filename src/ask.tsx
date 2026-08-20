/* eslint-disable @raycast/prefer-title-case -- todos os títulos de ação são literais em
   pt-BR da UX-SPEC (§2.1.1, §6.4, §10.3): "Copiar resposta", "Nova conversa", "Parar".
   §10.1 manda escrever em frase; Title Case em português desfiguraria a interface. */

/**
 * `Perguntar ao Hermes` — o comando principal (UX-SPEC §2.1 e §6).
 *
 * Fluxo, com o motor provado em D-01:
 *
 *   argumento vazio → Form (§2.1.1) → Enter
 *   POST /api/sessions {"source":"desktop"}  ← só quando a conversa é nova
 *   POST /v1/runs {input, session_id}        → 202
 *   GET  /v1/runs/{run_id}/events            → a resposta cresce dentro do <Detail>
 *
 * O que esta tela promete e cumpre:
 *
 * - **Fechar a janela não cancela nada** (D-02). A desmontagem aborta só o leitor local;
 *   o `run_id` já está no `LocalStorage` e a tarefa reaparece em `Execuções do Hermes`.
 * - **Nunca uma tela em branco.** Antes do primeiro pedaço de texto o usuário lê a própria
 *   pergunta e o estado **Preparando**; depois de 3 s, `O Hermes está pensando…` (§6.1).
 * - **Tudo pelo teclado.** Nenhuma ação existe só como atalho: o `ActionPanel` (`Ctrl+K`)
 *   lista todas, e os atalhos vêm da tabela única de `components/shortcuts.ts` (§9.2).
 * - **Rótulo de estado nunca é inventado**: sai de `src/lib/status.ts` (§4.2).
 */

import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  Icon,
  LaunchType,
  launchCommand,
  open,
  openExtensionPreferences,
  showHUD,
  showToast,
  Toast,
  useNavigation,
  type LaunchProps,
} from "@raycast/api";
import { useForm, usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { ApprovalView } from "./components/approval-view";
import { AutoDetectAction, NotConfigured } from "./components/first-run";
import { RenameSessionForm } from "./components/rename-session-form";
import { tagTone } from "./components/run-progress";
import { SHORTCUTS } from "./components/shortcuts";
import { SteerForm } from "./components/steer-form";
import { hermesDesktopSessionUrl } from "./lib/discovery";
import { sanitizeTechnical, toHermesError } from "./lib/errors";
import { flattenModelOptions, forkSession, getModelOptions, listSessions } from "./lib/hermes-api";
import { isConfigured } from "./lib/preferences";
import {
  isTerminalRunStatus,
  RUN_EXPIRED,
  RUN_EXPIRED_DETAIL,
  runStatusAppearance,
  runStatusLabel,
} from "./lib/status";
import { cachedFetch, CacheKeys, CacheTtl, listStoredRuns } from "./lib/storage";
import type { ModelOption, Session } from "./lib/types";
import { useRunStream, type RunStreamState } from "./hooks/use-run-stream";

const COMMAND_TITLE = "Perguntar ao Hermes";
const NEW_CONVERSATION = "new";
const PROMPT_IN_HEADER = 120;
const PROMPT_IN_TITLE = 40;
const TASK_PREVIEW = 60;
const RECENT_SESSIONS = 5;
/** §8.6: conversa mexida no Desktop há menos disto ⇒ aviso de escrita concorrente (R9). */
const CONCURRENT_WINDOW_MS = 30_000;

/* ────────────────────────────── Textos literais ────────────────────────────── */

const STOP_NOTE =
  "> Pedido de parada enviado. O Hermes está encerrando com segurança — isso pode levar alguns segundos se ele estiver no meio de uma ferramenta.";
const OFFLINE_NOTE =
  "> Acompanhando esta tarefa em modo simples. O texto que passou enquanto o Raycast estava fechado não pode ser recuperado, mas o resultado final aparece aqui.";
const CONCURRENT_NOTE =
  "> Esta conversa foi usada há pouco no Hermes Desktop. Se ela estiver aberta lá, espere a resposta terminar antes de continuar por aqui.";
const EMPTY_ANSWER = "O Hermes terminou sem escrever uma resposta.";
const PENDING_STEER_NOTE = "> Sua orientação chegou depois que o Hermes terminou. Quer enviá-la como próxima pergunta?";
/** E22 — a resposta do agente começa com o aviso de provedor não autenticado. */
const PROVIDER_AUTH_PREFIX = "⚠️ Provider authentication failed";
const PROVIDER_AUTH_MESSAGE =
  "O modelo escolhido não está autenticado no Hermes. Abra o Hermes Desktop e configure o provedor, ou escolha outro modelo.";

/* ──────────────────────────────── Utilidades ──────────────────────────────── */

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Números com vírgula decimal (§10.1). `12 s`, `0,4 s`. */
function formatDuration(ms: number): string {
  const value = ms / 1000;
  return value < 10 ? `${value.toFixed(1).replace(".", ",")} s` : `${Math.round(value)} s`;
}

function formatMoment(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

/** Data relativa curta para o seletor de conversas. `last_active` vem em SEGUNDOS. */
function formatRelative(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "";
  const date = new Date(epochSeconds * 1000);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 60 * 24) return `há ${Math.floor(minutes / 60)} h`;
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(date);
}

/**
 * Bloco de detalhes técnicos (§5.1) — oculto por padrão, sempre em bloco de código e
 * **sempre** filtrado por `sanitizeTechnical()`, mesmo quando não há segredo à vista.
 * A chave de acesso nunca chega aqui: este código não a lê em lugar nenhum.
 */
function technicalBlock(params: { endpoint?: string; runId?: string; sessionId?: string; detail?: string }): string {
  const lines = [
    params.endpoint ? `Endereço: ${params.endpoint}` : undefined,
    params.runId ? `Identificador da tarefa: ${params.runId}` : undefined,
    params.sessionId ? `Identificador da conversa: ${params.sessionId}` : undefined,
    `Momento: ${formatMoment(new Date())}`,
    params.detail,
  ].filter((line): line is string => line !== undefined && line !== "");

  return `### Detalhes técnicos\n\n\`\`\`\n${sanitizeTechnical(lines.join("\n"))}\n\`\`\``;
}

/* ─────────────────────────── Formulário de entrada ─────────────────────────── */

interface AskFormValues extends Form.Values {
  pergunta: string;
  conversa: string;
  modelo: string;
}

interface AskFormProps {
  /** `true` só quando este Form é a raiz do comando: rascunho de view empilhada não existe. */
  isRoot?: boolean;
  draftValues?: Form.Values;
  initialQuestion?: string;
  initialSessionId?: string;
  initialSessionTitle?: string;
}

function modelValue(option: ModelOption): string {
  return `${option.provider}::${option.model}`;
}

function parseModelValue(value: string): { model?: string; provider?: string } {
  if (value === "") return {};
  const separator = value.indexOf("::");
  if (separator < 0) return { model: value };
  return { provider: value.slice(0, separator), model: value.slice(separator + 2) };
}

async function openActiveRuns(): Promise<void> {
  try {
    await launchCommand({ name: "active-runs", type: LaunchType.UserInitiated });
  } catch {
    await showToast({ style: Toast.Style.Failure, title: "Não foi possível abrir as tarefas em andamento." });
  }
}

function AskForm(props: AskFormProps) {
  const { push } = useNavigation();

  // As três cargas são de segundo plano e NENHUMA bloqueia o envio (princípio 10 do brief):
  // se qualquer uma falhar, o formulário continua funcionando com o padrão do Hermes.
  const { data: sessions } = usePromise(async () => (await listSessions({ limit: RECENT_SESSIONS })).data, [], {
    onError: () => undefined,
  });
  const { data: models } = usePromise(
    async () =>
      flattenModelOptions(await cachedFetch(CacheKeys.modelOptions, CacheTtl.modelOptions, () => getModelOptions())),
    [],
    { onError: () => undefined },
  );
  const { data: runningCount } = usePromise(
    async () =>
      (await listStoredRuns()).filter(
        // `expired` é o 404 já observado (§4.3): a execução sumiu do servidor e não está
        // "em andamento". Sem este filtro o banner mentiria por até 7 dias, porque
        // `lastKnownStatus` fica congelado no último estado não terminal que vimos.
        (run) => run.expired !== true && !isTerminalRunStatus(run.lastKnownStatus),
      ).length,
    [],
    { onError: () => undefined },
  );

  const { handleSubmit, itemProps } = useForm<AskFormValues>({
    onSubmit(values) {
      const question = values.pergunta.trim();
      const sessionId = values.conversa === NEW_CONVERSATION ? undefined : values.conversa;
      const chosen = sessions?.find((session) => session.id === sessionId);
      const title = chosen?.title ?? (sessionId === props.initialSessionId ? props.initialSessionTitle : undefined);
      const { model, provider } = parseModelValue(values.modelo);

      // §8.6: avisar (não bloquear) quando a conversa acabou de ser usada fora do Raycast.
      const lastActiveMs = (chosen?.last_active ?? 0) * 1000;
      const warnConcurrent =
        sessionId !== undefined &&
        !sessionId.startsWith("raycast_") &&
        Date.now() - lastActiveMs < CONCURRENT_WINDOW_MS;

      push(
        <AnswerView
          prompt={question}
          sessionId={sessionId}
          sessionTitle={title ?? undefined}
          model={model}
          provider={provider}
          warnConcurrent={warnConcurrent}
        />,
      );
    },
    initialValues: {
      pergunta: props.initialQuestion ?? (props.draftValues?.pergunta as string | undefined) ?? "",
      conversa: props.initialSessionId ?? NEW_CONVERSATION,
      modelo: "",
    },
    validation: {
      // Mensagem literal da §2.1.1 — não usar o texto em inglês de `FormValidation.Required`.
      pergunta: (value) => (value !== undefined && value.trim() !== "" ? undefined : "Escreva sua pergunta."),
    },
  });

  const recent: Session[] = sessions ?? [];
  const preselected =
    props.initialSessionId !== undefined && !recent.some((session) => session.id === props.initialSessionId)
      ? props.initialSessionId
      : undefined;

  return (
    <Form
      navigationTitle={COMMAND_TITLE}
      enableDrafts={props.isRoot === true}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Perguntar ao Hermes" icon={Icon.SpeechBubble} onSubmit={handleSubmit} />
          {runningCount !== undefined && runningCount > 0 ? (
            <Action
              title="Ver tarefas em andamento"
              icon={Icon.Hourglass}
              shortcut={SHORTCUTS.activeRuns}
              onAction={() => void openActiveRuns()}
            />
          ) : null}
          <Action
            title="Abrir configurações"
            icon={Icon.Gear}
            shortcut={SHORTCUTS.preferences}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      {runningCount !== undefined && runningCount > 0 ? (
        <Form.Description
          title="Em andamento"
          text={
            runningCount === 1
              ? "Você tem 1 tarefa em andamento no Hermes."
              : `Você tem ${runningCount} tarefas em andamento no Hermes.`
          }
        />
      ) : null}

      <Form.TextArea
        {...itemProps.pergunta}
        title="Sua pergunta"
        placeholder="Escreva sua pergunta. Ex.: resuma este relatório em 5 tópicos."
        autoFocus
      />

      <Form.Dropdown {...itemProps.conversa} title="Conversa">
        <Form.Dropdown.Item value={NEW_CONVERSATION} title="Nova conversa" icon={Icon.Plus} />
        {preselected ? (
          <Form.Dropdown.Item
            value={preselected}
            title={props.initialSessionTitle ?? "Sem título"}
            icon={Icon.SpeechBubble}
          />
        ) : null}
        {recent.map((session) => (
          <Form.Dropdown.Item
            key={session.id}
            value={session.id}
            icon={Icon.SpeechBubble}
            title={`${session.title ?? "Sem título"}${
              formatRelative(session.last_active) === "" ? "" : ` · ${formatRelative(session.last_active)}`
            }`}
          />
        ))}
      </Form.Dropdown>

      <Form.Dropdown {...itemProps.modelo} title="Modelo">
        <Form.Dropdown.Item value="" title="Padrão do Hermes" icon={Icon.Wand} />
        {(models ?? []).map((option) => (
          <Form.Dropdown.Item
            key={modelValue(option)}
            value={modelValue(option)}
            title={`${option.model} · ${option.providerName}`}
            icon={option.authenticated ? undefined : Icon.Lock}
          />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

/* ──────────────────────────── A tela da resposta ──────────────────────────── */

type ViewMode = "resposta" | "etapas";

interface AnswerViewProps {
  prompt: string;
  sessionId?: string;
  sessionTitle?: string;
  model?: string;
  provider?: string;
  warnConcurrent?: boolean;
}

/** Monta o corpo em Markdown. O texto já recebido NUNCA é apagado por um erro (§5.3). */
function buildMarkdown(params: {
  prompt: string;
  state: RunStreamState;
  mode: ViewMode;
  warnConcurrent: boolean;
  showTechnical: boolean;
}): string {
  const { prompt, state, mode, warnConcurrent, showTechnical } = params;
  const terminal = isTerminalRunStatus(state.status);
  const blocks: string[] = [];

  if (state.stopRequested && !terminal) blocks.push(STOP_NOTE);
  if (warnConcurrent) blocks.push(CONCURRENT_NOTE);
  if (state.approval !== undefined) {
    blocks.push(
      [
        "> 🔐 **O Hermes precisa da sua permissão para continuar.**",
        ">",
        `> ${state.approval.fields.description ?? "Ele quer executar um comando no seu computador."}`,
        ">",
        "> Abra **Responder pedido de aprovação** para ver o comando e decidir.",
      ].join("\n"),
    );
  }
  if (!state.liveStream && !terminal && state.streamFailure?.canReattach === false) blocks.push(OFFLINE_NOTE);

  if (mode === "etapas") {
    blocks.push("### Etapas");
    blocks.push(state.steps.length > 0 ? state.steps.join("\n\n") : "_Nenhuma etapa até agora._");
  } else {
    blocks.push(`### ${truncate(prompt, PROMPT_IN_HEADER)}`);
    if (state.activeTool !== undefined) blocks.push(`> 🔧 Usando ${state.activeTool}…`);

    if (state.text !== "") blocks.push(state.text);
    else if (terminal) blocks.push(EMPTY_ANSWER);
    else blocks.push(state.thinking ? "_O Hermes está pensando…_" : "_Preparando…_");
  }

  if (state.pendingSteer !== undefined && state.pendingSteer !== "") blocks.push(PENDING_STEER_NOTE);

  const failure = state.expired
    ? RUN_EXPIRED_DETAIL
    : state.text.startsWith(PROVIDER_AUTH_PREFIX)
      ? PROVIDER_AUTH_MESSAGE
      : state.streamFailure?.message;

  if (failure !== undefined) {
    blocks.push("---");
    blocks.push(failure);
    if (showTechnical) {
      blocks.push(
        technicalBlock({
          endpoint: state.baseUrl,
          runId: state.runId,
          sessionId: state.sessionId,
          detail: state.streamFailure?.technical,
        }),
      );
    }
  } else if (showTechnical) {
    blocks.push("---");
    blocks.push(technicalBlock({ endpoint: state.baseUrl, runId: state.runId, sessionId: state.sessionId }));
  }

  return blocks.join("\n\n");
}

function AnswerView(props: AnswerViewProps) {
  const { state, stop, steer, reattach, retry, approvalResolved } = useRunStream({
    prompt: props.prompt,
    sessionId: props.sessionId,
    sessionTitle: props.sessionTitle,
    model: props.model,
    provider: props.provider,
  });

  const [mode, setMode] = useState<ViewMode>("resposta");
  const [showTechnical, setShowTechnical] = useState(false);
  const [renamedTitle, setRenamedTitle] = useState<string | undefined>(undefined);

  const toastRef = useRef<Toast | undefined>(undefined);
  const syncToastRef = useRef(false);

  const terminal = isTerminalRunStatus(state.status);
  const title = renamedTitle ?? state.sessionTitle;
  const desktopUrl = hermesDesktopSessionUrl(state.sessionId);
  const hasText = state.text !== "";

  // §2.1.2 passo 1 e 6: um Toast animado enquanto nada chegou, escondido no primeiro sinal.
  useEffect(() => {
    let dismissed = false;
    void showToast({ style: Toast.Style.Animated, title: "Enviando ao Hermes…" }).then((toast) => {
      if (dismissed) void toast.hide();
      else toastRef.current = toast;
    });
    return () => {
      dismissed = true;
      void toastRef.current?.hide();
      toastRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (state.text === "" && state.steps.length === 0 && !terminal) return;
    void toastRef.current?.hide();
    toastRef.current = undefined;
  }, [state.text, state.steps.length, terminal]);

  // §8.2 item 5: uma vez por conversa nova, quando a primeira resposta fica pronta.
  useEffect(() => {
    if (syncToastRef.current || state.status !== "completed" || !state.newConversation) return;
    const url = hermesDesktopSessionUrl(state.sessionId);
    if (url === undefined) return;
    syncToastRef.current = true;
    void showToast({
      style: Toast.Style.Success,
      title: "Esta conversa já está no Hermes Desktop",
      primaryAction: {
        title: "Abrir no Hermes Desktop",
        onAction: (toast) => {
          void open(url);
          void toast.hide();
        },
      },
    });
  }, [state.status, state.newConversation, state.sessionId]);

  async function copyAnswer(): Promise<void> {
    await Clipboard.copy(state.text);
    await showHUD("Resposta copiada");
  }

  async function branch(): Promise<void> {
    if (state.sessionId === undefined) return;
    try {
      await forkSession(state.sessionId);
      await showToast({
        style: Toast.Style.Success,
        title: "Nova conversa criada a partir desta",
        // O filho é carimbado `source: "api_server"` pelo servidor e não é patchável (R7).
        message: "Esta nova conversa não aparece na lista principal do Hermes Desktop.",
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: toHermesError(err, `POST /api/sessions/${state.sessionId}/fork`).userMessage,
      });
    }
  }

  const appearance = state.expired ? RUN_EXPIRED : runStatusAppearance(state.status);
  const statusLabel = state.expired ? RUN_EXPIRED.label : runStatusLabel(state.status);
  const duration = state.finishedAt !== undefined ? formatDuration(state.finishedAt - state.startedAt) : undefined;
  // Nomes das ferramentas usadas, extraídos das próprias linhas de Etapas (§6.3).
  const usedTools = [
    ...new Set(
      state.steps
        .map((step) => /^🔧 Usando ([^—]+)/u.exec(step)?.[1]?.trim())
        .filter((tool): tool is string => tool !== undefined && tool !== ""),
    ),
  ];

  // Erro que aconteceu antes de existir qualquer conteúdo: toma a tela (§5.3).
  if (state.fatalError !== undefined && !hasText) {
    const technical = technicalBlock({
      endpoint: state.baseUrl,
      runId: state.runId,
      sessionId: state.sessionId,
      detail: state.fatalError.technical,
    });
    return (
      <Detail
        navigationTitle={COMMAND_TITLE}
        markdown={`# Não foi possível perguntar\n\n${state.fatalError.userMessage}\n\n${
          showTechnical ? technical : ""
        }`}
        actions={
          <ActionPanel>
            {/* §5.2 E2: com a chave recusada, a PRIMEIRA ação é redetectar. `Tentar
                novamente` com a mesma chave só repetiria o 401. */}
            {state.fatalError.uxId === "E2" ? <AutoDetectAction onDone={retry} /> : null}
            <Action title="Tentar novamente" icon={Icon.ArrowClockwise} shortcut={SHORTCUTS.refresh} onAction={retry} />
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
              onAction={() => setShowTechnical((value) => !value)}
            />
            <Action.CopyToClipboard
              title="Copiar detalhes técnicos"
              content={technical}
              shortcut={SHORTCUTS.copyTechnical}
            />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <Detail
      navigationTitle={title ?? truncate(props.prompt, PROMPT_IN_TITLE)}
      isLoading={!terminal && !state.expired}
      markdown={buildMarkdown({
        prompt: props.prompt,
        state,
        mode,
        warnConcurrent: props.warnConcurrent === true,
        showTechnical,
      })}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Estado">
            <Detail.Metadata.TagList.Item text={statusLabel} {...tagTone(appearance)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Conversa" text={title ?? "Sem título"} />
          <Detail.Metadata.Label title="Modelo" text={state.model ?? "Padrão do Hermes"} />
          <Detail.Metadata.Label title="Sincronização" text="Aparece no Hermes Desktop" />
          {duration !== undefined ? <Detail.Metadata.Label title="Duração" text={duration} /> : null}
          {mode === "etapas" && usedTools.length > 0 ? (
            <Detail.Metadata.TagList title="Etapas">
              {usedTools.slice(0, 6).map((tool) => (
                <Detail.Metadata.TagList.Item key={tool} text={tool} />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {state.approval !== undefined ? (
              <Action.Push
                title="Responder pedido de aprovação"
                icon={Icon.Lock}
                target={
                  <ApprovalView
                    runId={state.runId ?? ""}
                    fields={state.approval.fields}
                    pendingCount={state.approval.pendingCount}
                    detailsLost={state.approval.detailsLost}
                    taskPreview={truncate(props.prompt, TASK_PREVIEW)}
                    conversationTitle={title ?? "Sem título"}
                    sessionId={state.sessionId}
                    onResolved={(_choice, resolved) => approvalResolved(resolved)}
                    // §7.4 `Ver etapas da tarefa`: esta tela É a tarefa; trocar o modo faz
                    // o `Esc` do usuário voltar direto para as etapas.
                    onShowSteps={() => setMode("etapas")}
                  />
                }
              />
            ) : null}

            {state.streamFailure?.canReattach === true && !terminal && !state.expired ? (
              // E23: reassina o stream da MESMA tarefa; nunca dispara outra execução.
              <Action
                title="Acompanhar de novo"
                icon={Icon.ArrowClockwise}
                shortcut={SHORTCUTS.refresh}
                onAction={reattach}
              />
            ) : null}

            {!terminal && !state.expired ? (
              <Action
                title="Parar"
                icon={Icon.Stop}
                style={Action.Style.Destructive}
                shortcut={SHORTCUTS.stop}
                // §6.6 item 6: sem `confirmAlert` — nada é destruído e a confirmação
                // atrasaria a única saída de emergência do usuário.
                onAction={() => void stop()}
              />
            ) : null}

            {terminal && hasText ? (
              <Action
                title={state.status === "completed" ? "Copiar resposta" : "Copiar o que já veio"}
                icon={Icon.Clipboard}
                shortcut={SHORTCUTS.copy}
                onAction={() => void copyAnswer()}
              />
            ) : null}

            {terminal && hasText ? (
              <Action.Paste
                title="Colar no aplicativo ativo"
                icon={Icon.Text}
                content={state.text}
                shortcut={SHORTCUTS.paste}
                onPaste={() => void showHUD("Resposta colada")}
              />
            ) : null}

            {/* Falhou, foi cancelada, expirou — ou terminou sem escrever nada (§2.1.4). */}
            {(terminal && (state.status !== "completed" || !hasText)) || state.expired ? (
              <Action
                title="Tentar novamente"
                icon={Icon.ArrowClockwise}
                shortcut={SHORTCUTS.refresh}
                onAction={retry}
              />
            ) : null}
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title={mode === "resposta" ? "Ver etapas" : "Ver resposta"}
              icon={mode === "resposta" ? Icon.List : Icon.Text}
              shortcut={SHORTCUTS.toggleSteps}
              onAction={() => setMode((value) => (value === "resposta" ? "etapas" : "resposta"))}
            />

            {!terminal && hasText ? (
              <Action
                title="Copiar o que já veio"
                icon={Icon.Clipboard}
                shortcut={SHORTCUTS.copy}
                onAction={() => void copyAnswer()}
              />
            ) : null}

            {/* Steer só é aceito com o estado exatamente `running` (armadilha 22). */}
            {state.status === "running" ? (
              <Action.Push
                title="Orientar execução"
                icon={Icon.Compass}
                shortcut={SHORTCUTS.steer}
                target={<SteerForm onSend={steer} />}
              />
            ) : null}

            {/* R9: no máximo UM turno vivo por `session_id` — não há trava entre
                superfícies e duas escritas concorrentes se intercalam no `state.db`. A
                §6.4 lista esta ação só em "Depois (Concluído)". */}
            {terminal && state.sessionId !== undefined ? (
              <Action.Push
                title="Continuar esta conversa"
                icon={Icon.SpeechBubble}
                shortcut={SHORTCUTS.continueConversation}
                target={<AskForm initialSessionId={state.sessionId} initialSessionTitle={title ?? undefined} />}
              />
            ) : null}

            <Action.Push
              title={terminal ? "Nova conversa" : "Perguntar de novo"}
              icon={Icon.Plus}
              shortcut={SHORTCUTS.newConversation}
              target={<AskForm initialQuestion={terminal ? undefined : props.prompt} />}
            />

            {desktopUrl !== undefined ? (
              <Action.Open
                title="Abrir no Hermes Desktop"
                icon={Icon.Desktop}
                target={desktopUrl}
                shortcut={SHORTCUTS.openInDesktop}
              />
            ) : null}

            {terminal && state.sessionId !== undefined ? (
              <Action
                title="Ramificar conversa"
                icon={Icon.Repeat}
                shortcut={SHORTCUTS.branch}
                onAction={() => void branch()}
              />
            ) : null}

            {state.sessionId !== undefined ? (
              <Action.Push
                title="Renomear conversa"
                icon={Icon.Pencil}
                shortcut={SHORTCUTS.rename}
                target={
                  <RenameSessionForm
                    session={{ id: state.sessionId, title: title ?? null }}
                    onRenamed={(updated) => setRenamedTitle(updated.title ?? undefined)}
                  />
                }
              />
            ) : null}
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title={showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
              icon={showTechnical ? Icon.EyeDisabled : Icon.Eye}
              shortcut={SHORTCUTS.showTechnical}
              onAction={() => setShowTechnical((value) => !value)}
            />
            <Action.CopyToClipboard
              title="Copiar detalhes técnicos"
              content={technicalBlock({
                endpoint: state.baseUrl,
                runId: state.runId,
                sessionId: state.sessionId,
                detail: state.streamFailure?.technical,
              })}
              shortcut={SHORTCUTS.copyTechnical}
            />
            <Action
              title="Ver tarefas em andamento"
              icon={Icon.Hourglass}
              shortcut={SHORTCUTS.activeRuns}
              onAction={() => void openActiveRuns()}
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

/* ─────────────────────────────── O comando ─────────────────────────────── */

type AskArguments = {
  /** `required: false` no manifest: vazio nunca é erro, leva ao formulário (§2.1.1). */
  pergunta?: string;
};

/**
 * O que `Continuar esta conversa` entrega quando lança este comando de outra tela
 * (`session-detail.tsx#continueConversation`). É um `type`, e não uma `interface`, porque
 * só um alias de objeto é atribuível ao índice de `LaunchContext`.
 */
type AskLaunchContext = {
  sessionId?: string;
  sessionTitle?: string;
  /** §8.6: a conversa foi mexida no Hermes Desktop há menos de 30 s. */
  avisoUsoRecente?: boolean;
};

export default function Command(
  props: LaunchProps<{ arguments: AskArguments; draftValues: Form.Values; launchContext: AskLaunchContext }>,
) {
  const question = (props.arguments?.pergunta ?? "").trim();
  // `Continuar esta conversa` chega por aqui: sem ler o contexto, a continuação viraria
  // silenciosamente uma conversa nova e o histórico do Hermes Desktop se partiria em dois.
  const context = props.launchContext;
  const sessionId = context?.sessionId;
  const sessionTitle = context?.sessionTitle;

  // Guarda de configuração (§2, convenções): antes de qualquer requisição, resolve a chave.
  const { data: configured, isLoading, revalidate } = usePromise(isConfigured);

  if (isLoading) {
    return (
      <Detail
        isLoading
        navigationTitle={COMMAND_TITLE}
        markdown="_Preparando…_"
        actions={
          <ActionPanel>
            <Action
              title="Abrir configurações"
              icon={Icon.Gear}
              shortcut={SHORTCUTS.preferences}
              onAction={openExtensionPreferences}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (configured !== true) return <NotConfigured commandTitle={COMMAND_TITLE} onRetry={revalidate} />;

  if (question === "") {
    return (
      <AskForm isRoot draftValues={props.draftValues} initialSessionId={sessionId} initialSessionTitle={sessionTitle} />
    );
  }

  return (
    <AnswerView
      prompt={question}
      sessionId={sessionId}
      sessionTitle={sessionTitle}
      warnConcurrent={context?.avisoUsoRecente === true}
    />
  );
}
