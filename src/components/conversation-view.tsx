/* eslint-disable @raycast/prefer-title-case -- todos os títulos de ação são literais em
   pt-BR da UX-SPEC (§6.4, §10.3) e do desenho da conversa contínua (§6): "Copiar resposta",
   "Nova conversa", "Parar". A §10.1 manda escrever em frase; Title Case do inglês
   desfiguraria a interface. */

/**
 * A conversa — a tela principal do produto
 * (desenho `docs/superpowers/specs/2026-08-19-conversa-continua-design.md` §4 a §6).
 *
 * Um `List` só, sem empilhar nada por turno:
 *
 *   barra de busca  = campo de escrita (`filtering={false}`, `searchText` controlado)
 *   `Enter`         = enviar, por ser a PRIMEIRA ação do painel — nunca por `shortcut`
 *   um item         = uma troca inteira (sua pergunta no título, a resposta no painel)
 *
 * O que esta tela promete e cumpre:
 *
 * - **Continuar não dá trabalho.** Não há "Continuar esta conversa": continuar é escrever
 *   e apertar `Enter`, como em qualquer conversa.
 * - **Uma linha nunca é meia troca.** A resposta jamais é irmã da pergunta na lista: ela é
 *   o corpo dela. É isto que conserta a confusão do detalhe da conversa (§1 do desenho).
 * - **Fechar a janela não cancela nada** (D-02). A desmontagem aborta só o leitor local.
 * - **Um turno vivo por conversa** (R9): escrever durante uma resposta enfileira.
 * - **Rótulo de estado nunca é inventado**: sai de `src/lib/status.ts`.
 */

import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Form,
  Icon,
  LaunchType,
  List,
  Toast,
  confirmAlert,
  launchCommand,
  open,
  showHUD,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { useConversation, RENDER_TURN_LIMIT } from "../hooks/use-conversation";
import { hermesDesktopSessionUrl } from "../lib/discovery";
import { sanitizeTechnical, toHermesError, type HermesError } from "../lib/errors";
import { forkSession, listSessions } from "../lib/hermes-api";
import { isTurnFinished, type Turn, type TurnMode } from "../lib/turns";
import { createTurnDerivationCache } from "../lib/turn-derivations";
import type { Session } from "../lib/types";
import { ApprovalView } from "./approval-view";
import { AutoDetectAction } from "./first-run";
import { NO_TITLE, OpenModelsAction, OpenPreferencesAction, SYNC_PROMISE } from "./common";
import { RenameSessionForm } from "./rename-session-form";
import { statusImage, tagTone } from "./run-progress";
import { SessionDetail, shouldWarnAboutRecentDesktopUse } from "../session-detail";
import { SHORTCUTS } from "./shortcuts";
import { SteerForm } from "./steer-form";
import { conversationDropdownLabel } from "../lib/ui-text";

const COMMAND_TITLE = "Perguntar ao Hermes";
const NEW_CONVERSATION = "new";
/** §2.1.3: sem título da conversa, os 40 primeiros caracteres da primeira mensagem. */
const PROMPT_IN_TITLE = 40;
const TASK_PREVIEW = 60;
/** §4.1: as 5 conversas mais recentes no seletor da barra. */
const RECENT_SESSIONS = 5;

/* ────────────────────────────── Textos literais ────────────────────────────── */

const STOP_NOTE =
  "> Pedido de parada enviado. O Hermes está encerrando com segurança — isso pode levar alguns segundos se ele estiver no meio de uma ferramenta.";
const OFFLINE_NOTE =
  "> Acompanhando esta tarefa em modo simples. O texto que passou enquanto o Raycast estava fechado não pode ser recuperado, mas o resultado final aparece aqui.";
const CONCURRENT_NOTE =
  "> Esta conversa foi usada há pouco no Hermes Desktop. Se ela estiver aberta lá, espere a resposta terminar antes de continuar por aqui.";
const PENDING_STEER_NOTE = "> Sua orientação chegou depois que o Hermes terminou. Quer enviá-la como próxima pergunta?";
/** §8.5 do desenho: aviso, nunca bloqueio. */
const HISTORY_FAILED_TITLE = "Não foi possível carregar as mensagens anteriores desta conversa";
const HISTORY_FAILED_NOTE = `> ${HISTORY_FAILED_TITLE}.`;

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

async function openActiveRuns(): Promise<void> {
  try {
    await launchCommand({ name: "active-runs", type: LaunchType.UserInitiated });
  } catch {
    await showToast({ style: Toast.Style.Failure, title: "Não foi possível abrir as tarefas em andamento." });
  }
}

/* ───────────────────── O desvio para mensagem longa (§5) ───────────────────── */

/**
 * `Escrever mensagem longa`. Existe porque o Raycast não expõe interceptação de tecla: na
 * barra de busca não há como quebrar linha. Aqui o `Enter` do `Form.TextArea` faz o que
 * fizer, e quem envia é `Ctrl+Enter` — a ação primária de um `Form`.
 */
function LongMessageForm({
  initialText,
  onSend,
}: {
  initialText: string;
  onSend: (text: string) => void;
}): ReactElement {
  const { pop } = useNavigation();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Form
      navigationTitle="Escrever mensagem longa"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Perguntar ao Hermes"
            icon={Icon.SpeechBubble}
            onSubmit={() => {
              if (text.trim() === "") {
                // Literal da §2.1.1 — não usar o texto em inglês de `FormValidation.Required`.
                setError("Escreva sua pergunta.");
                return;
              }
              onSend(text);
              pop();
            }}
          />
          <OpenPreferencesAction />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="pergunta"
        title="Sua pergunta"
        placeholder="Escreva sua pergunta. Ex.: resuma este relatório em 5 tópicos."
        autoFocus
        value={text}
        error={error}
        onChange={(value) => {
          setText(value);
          if (error !== undefined) setError(undefined);
        }}
      />
      <Form.Description title="Como enviar" text="Pressione Ctrl+Enter para enviar. Esc volta para a conversa." />
    </Form>
  );
}

/* ──────────────────────────────── A tela ──────────────────────────────── */

export interface ConversationViewProps {
  /** Conversa de partida (do `launchContext`); sem ela, a última usada. */
  initialSessionId?: string;
  initialSessionTitle?: string;
  /** Argumento `pergunta` do comando: enviado como primeiro turno, sem tela nenhuma. */
  initialMessage?: string;
  /** §8.6: a conversa foi mexida no Hermes Desktop há menos de 30 s. */
  warnConcurrent?: boolean;
  /** Abre em conversa nova, ignorando a última usada (comandos de texto da fase 2). */
  startNewConversation?: boolean;
}

export function ConversationView(props: ConversationViewProps): ReactElement {
  const conversation = useConversation({
    initialSessionId: props.initialSessionId,
    initialSessionTitle: props.initialSessionTitle,
    initialMessage: props.initialMessage,
    startNewConversation: props.startNewConversation,
  });

  const [searchText, setSearchText] = useState("");
  const [mode, setMode] = useState<TurnMode>("resposta");
  const [showTechnical, setShowTechnical] = useState(false);
  /**
   * §4.5: estaciona no turno recém-criado e é liberado quando ele chega a estado terminal.
   * `onSelectionChange` fica de fora de propósito: tem corrida conhecida
   * (raycast/extensions#10844) e a extensão ChatGPT da loja o removeu pelo mesmo motivo.
   */
  const [pinnedId, setPinnedId] = useState<string | undefined>(undefined);
  /**
   * O seletor de conversas é controlado por `value`. Quando a troca é recusada no
   * `confirmAlert`, nada no estado muda — e sem re-render o seletor fica exibindo a conversa
   * que NÃO foi aberta. Remontá-lo pela `key` é o jeito de fazê-lo voltar ao valor real.
   */
  const [dropdownNonce, setDropdownNonce] = useState(0);
  /** §8.6: o aviso de uso concorrente vale para o primeiro turno desta abertura, e só. */
  const [concurrentNotice, setConcurrentNotice] = useState(props.warnConcurrent === true);
  const syncToastRef = useRef(false);
  const turnDerivationCacheRef = useRef(createTurnDerivationCache());

  const { data: sessions } = usePromise(async () => (await listSessions({ limit: RECENT_SESSIONS })).data, [], {
    onError: () => undefined,
  });

  const { turns, sessionId, sessionTitle } = conversation;
  const liveTurn = turns.find((turn) => turn.id === conversation.liveTurnId);
  const desktopUrl = hermesDesktopSessionUrl(sessionId);

  useEffect(() => {
    syncToastRef.current = false;
    turnDerivationCacheRef.current.clear();
  }, [sessionId]);

  // Solta a seleção quando o turno fixado termina: daí em diante as setas navegam livres.
  useEffect(() => {
    if (pinnedId === undefined) return;
    const turn = turns.find((item) => item.id === pinnedId);
    if (turn === undefined || isTurnFinished(turn)) setPinnedId(undefined);
  }, [turns, pinnedId]);

  // O aviso de uso concorrente some quando o primeiro turno desta abertura termina: ele
  // fala de uma janela de 30 s, e repeti-lo em todos os turnos seguintes seria ruído.
  useEffect(() => {
    if (!concurrentNotice) return;
    if (turns.some((turn) => turn.state.kind === "live" && isTurnFinished(turn))) setConcurrentNotice(false);
  }, [turns, concurrentNotice]);

  // §8.2 item 5: uma vez por conversa nova, quando a primeira resposta fica pronta.
  useEffect(() => {
    if (syncToastRef.current || !conversation.newConversation || sessionId === undefined) return;
    const answered = turns.some((turn) => turn.state.kind === "live" && turn.state.status === "completed");
    if (!answered) return;
    const url = hermesDesktopSessionUrl(sessionId);
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
  }, [turns, conversation.newConversation, sessionId]);

  /* ───────────────────────────── Ações ───────────────────────────── */

  function sendText(text: string): void {
    const id = conversation.send(text);
    if (id === undefined) return;
    setPinnedId(id);
    setSearchText("");
  }

  /**
   * §4.1: o rascunho da barra sobrevive à troca de conversa (é seu, não da conversa). A fila
   * fica persistida por conversa e só é descartada quando a pessoa confirma explicitamente.
   */
  async function changeSession(next: string | undefined, chosen?: Session): Promise<void> {
    if (next === sessionId) return;
    const queued = turns.filter((turn) => turn.state.kind === "queued");
    if (queued.length > 0) {
      const confirmed = await confirmAlert({
        title: "Descartar as mensagens que ainda não foram enviadas?",
        message:
          queued.length === 1
            ? "Você tem 1 mensagem esperando nesta conversa. Trocar de conversa apaga o que está esperando; o que já foi enviado continua no Hermes."
            : `Você tem ${queued.length} mensagens esperando nesta conversa. Trocar de conversa apaga o que está esperando; o que já foi enviado continua no Hermes.`,
        primaryAction: { title: "Trocar de conversa", style: Alert.ActionStyle.Destructive },
        dismissAction: { title: "Continuar aqui" },
        rememberUserChoice: false,
      });
      if (!confirmed) {
        setDropdownNonce((value) => value + 1);
        return;
      }
      for (const turn of queued) conversation.dequeue(turn.id);
    }
    if (liveTurn !== undefined) {
      // A tarefa continua viva do lado do Hermes: só o acompanhamento local é largado.
      await showToast({ title: "A tarefa continua rodando no Hermes mesmo se você fechar o Raycast." });
    }
    conversation.switchSession(next, chosen?.title ?? undefined);
    setPinnedId(undefined);

    // §8.6 também vale aqui. Chegar por `Conversas` avisa (`continueConversation`), mas trocar
    // pelo seletor da barra chega à mesma conversa por outra porta — e sem isto era a única
    // porta muda. Avisa e não bloqueia, como manda a seção.
    const warn = chosen !== undefined && shouldWarnAboutRecentDesktopUse(chosen);
    setConcurrentNotice(warn);
    if (warn) {
      await showToast({
        title: "Esta conversa foi usada há pouco no Hermes Desktop",
        message: "Se ela estiver aberta lá, espere a resposta terminar antes de continuar por aqui.",
      });
    }
  }

  async function copyText(text: string): Promise<void> {
    await Clipboard.copy(text);
    await showHUD("Resposta copiada");
  }

  async function branch(): Promise<void> {
    if (sessionId === undefined) return;
    try {
      await forkSession(sessionId);
      await showToast({
        style: Toast.Style.Success,
        title: "Nova conversa criada a partir desta",
        // O filho é carimbado `source: "api_server"` pelo servidor e não é patchável (R7).
        message: "Esta nova conversa não aparece na lista principal do Hermes Desktop.",
      });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: toHermesError(err, `POST /api/sessions/${sessionId}/fork`).userMessage,
      });
    }
  }

  /* ─────────────────────── Blocos de ação reutilizados ─────────────────────── */

  /** A PRIMEIRA ação de todo painel. Sem `shortcut`: é ela que o `Enter` aciona. */
  const sendAction = <Action title="Enviar" icon={Icon.SpeechBubble} onAction={() => sendText(searchText)} />;

  const modeAction = (
    <Action
      title={mode === "resposta" ? "Ver etapas" : "Ver resposta"}
      icon={mode === "resposta" ? Icon.List : Icon.Text}
      shortcut={SHORTCUTS.toggleSteps}
      onAction={() => setMode((value) => (value === "resposta" ? "etapas" : "resposta"))}
    />
  );

  function conversationSection(): ReactElement {
    return (
      <ActionPanel.Section>
        <Action.Push
          title="Escrever mensagem longa"
          icon={Icon.Pencil}
          target={<LongMessageForm initialText={searchText} onSend={sendText} />}
        />
        <Action
          title="Nova conversa"
          icon={Icon.Plus}
          shortcut={SHORTCUTS.newConversation}
          onAction={() => void changeSession(undefined)}
        />
        {conversation.hasOlder ? (
          <Action
            title="Carregar parte anterior da conversa"
            icon={Icon.ArrowUp}
            shortcut={SHORTCUTS.loadOlder}
            onAction={() => void conversation.loadOlder()}
          />
        ) : null}
        {desktopUrl !== undefined ? (
          <Action.Open
            title="Abrir no Hermes Desktop"
            icon={Icon.Desktop}
            target={desktopUrl}
            shortcut={SHORTCUTS.openInDesktop}
          />
        ) : null}
        {sessionId !== undefined ? (
          <Action.Push
            title="Renomear conversa"
            icon={Icon.Pencil}
            shortcut={SHORTCUTS.rename}
            target={
              <RenameSessionForm
                session={{ id: sessionId, title: sessionTitle ?? null }}
                onRenamed={(updated) => conversation.setSessionTitle(updated.title ?? undefined)}
              />
            }
          />
        ) : null}
        {sessionId !== undefined ? (
          <Action
            title="Ramificar conversa"
            icon={Icon.Layers}
            shortcut={SHORTCUTS.branch}
            onAction={() => void branch()}
          />
        ) : null}
        {sessionId !== undefined ? (
          <Action.Push
            title="Ver mensagens e ferramentas"
            icon={Icon.WrenchScrewdriver}
            shortcut={SHORTCUTS.viewMessages}
            target={<SessionDetail session={{ id: sessionId, title: sessionTitle ?? null }} />}
          />
        ) : null}
        <OpenModelsAction />
      </ActionPanel.Section>
    );
  }

  function diagnosticsSection(detail?: string): ReactElement {
    return (
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
            endpoint: conversation.baseUrl,
            runId: conversation.runId,
            sessionId,
            detail: detail ?? conversation.streamFailure?.technical,
          })}
          shortcut={SHORTCUTS.copyTechnical}
        />
        <Action
          title="Ver tarefas em andamento"
          icon={Icon.Hourglass}
          shortcut={SHORTCUTS.activeRuns}
          onAction={() => void openActiveRuns()}
        />
        <OpenPreferencesAction />
      </ActionPanel.Section>
    );
  }

  /* ─────────────────────────── O painel de um turno ─────────────────────────── */

  function turnActions(turn?: Turn): ReactElement {
    const isLive = turn !== undefined && turn.id === conversation.liveTurnId;
    const finished = turn !== undefined && isTurnFinished(turn);
    const queued = turn?.state.kind === "queued";
    const status = turn?.state.kind === "live" ? turn.state.status : undefined;
    const hasText = turn !== undefined && turn.answer !== "";
    const canRetry =
      turn !== undefined &&
      turn.state.kind === "live" &&
      (turn.expired === true || turn.state.status !== "completed" || turn.answer === "");

    return (
      <ActionPanel>
        <ActionPanel.Section>
          {sendAction}

          {isLive && conversation.approval !== undefined ? (
            <Action.Push
              title="Responder pedido de aprovação"
              icon={Icon.Lock}
              target={
                <ApprovalView
                  runId={conversation.runId ?? ""}
                  fields={conversation.approval.fields}
                  pendingCount={conversation.approval.pendingCount}
                  detailsLost={conversation.approval.detailsLost}
                  taskPreview={truncate(turn?.message ?? "", TASK_PREVIEW)}
                  conversationTitle={sessionTitle ?? NO_TITLE}
                  sessionId={sessionId}
                  onResolved={(_choice, resolved) => conversation.approvalResolved(resolved)}
                  // §7.4 `Ver etapas da tarefa`: esta tela É a tarefa; trocar o modo faz o
                  // `Esc` do usuário voltar direto para as etapas.
                  onShowSteps={() => setMode("etapas")}
                />
              }
            />
          ) : null}

          {/* E23: reassina o stream da MESMA tarefa; nunca dispara outra execução. */}
          {isLive && !finished && conversation.streamFailure?.canReattach === true ? (
            <Action
              title="Acompanhar de novo"
              icon={Icon.ArrowClockwise}
              shortcut={SHORTCUTS.refresh}
              onAction={conversation.reattach}
            />
          ) : null}

          {isLive && !finished ? (
            <Action
              title="Parar"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              shortcut={SHORTCUTS.stop}
              // §6.6 item 6: sem `confirmAlert` — nada é destruído e a confirmação
              // atrasaria a única saída de emergência do usuário.
              onAction={() => void conversation.stop()}
            />
          ) : null}

          {/* Steer só é aceito com o estado exatamente `running` (armadilha 22). */}
          {isLive && status === "running" ? (
            <Action.Push
              title="Orientar execução"
              icon={Icon.Compass}
              shortcut={SHORTCUTS.steer}
              target={<SteerForm onSend={conversation.steer} />}
            />
          ) : null}

          {queued && turn !== undefined ? (
            <Action
              title="Remover da fila"
              icon={Icon.Trash}
              shortcut={SHORTCUTS.remove}
              // Sem `confirmAlert`: nada é destruído no servidor e o texto volta
              // disponível pela ação seguinte.
              onAction={() => conversation.dequeue(turn.id)}
            />
          ) : null}

          {queued && turn !== undefined ? (
            <Action
              title="Editar antes de enviar"
              icon={Icon.Pencil}
              onAction={() => {
                setSearchText(turn.message);
                conversation.dequeue(turn.id);
              }}
            />
          ) : null}

          {hasText && turn !== undefined ? (
            <Action
              title={
                finished && (turn.state.kind === "past" || status === "completed")
                  ? "Copiar resposta"
                  : "Copiar o que já veio"
              }
              icon={Icon.Clipboard}
              shortcut={SHORTCUTS.copy}
              onAction={() => void copyText(turn.answer)}
            />
          ) : null}

          {finished && hasText && turn !== undefined ? (
            <Action.Paste
              title="Colar no aplicativo ativo"
              icon={Icon.Text}
              content={turn.answer}
              shortcut={SHORTCUTS.paste}
              onPaste={() => void showHUD("Resposta colada")}
            />
          ) : null}

          {finished && canRetry && turn !== undefined ? (
            <Action
              title="Tentar novamente"
              icon={Icon.ArrowClockwise}
              shortcut={SHORTCUTS.refresh}
              onAction={() => conversation.retry(turn.id)}
            />
          ) : null}

          {turn !== undefined ? modeAction : null}
        </ActionPanel.Section>

        {conversationSection()}
        {diagnosticsSection()}
      </ActionPanel>
    );
  }

  /** Avisos que falam da TELA agora, não do conteúdo da troca: vão acima do corpo dela. */
  function turnNotes(turn: Turn, isLive: boolean): string[] {
    const notes: string[] = [];
    if (!isLive) return notes;

    if (conversation.stopRequested && !isTurnFinished(turn)) notes.push(STOP_NOTE);
    if (concurrentNotice) notes.push(CONCURRENT_NOTE);
    if (conversation.approval !== undefined) {
      notes.push(
        [
          "> 🔐 **O Hermes precisa da sua permissão para continuar.**",
          ">",
          `> ${conversation.approval.fields.description ?? "Ele quer executar um comando no seu computador."}`,
          ">",
          "> Abra **Responder pedido de aprovação** para ver o comando e decidir.",
        ].join("\n"),
      );
    }
    if (!conversation.liveStream && !isTurnFinished(turn) && conversation.streamFailure?.canReattach === false) {
      notes.push(OFFLINE_NOTE);
    }
    if (mode === "resposta" && conversation.activeTool !== undefined) {
      notes.push(`> 🔧 Usando ${conversation.activeTool}…`);
    }
    return notes;
  }

  function turnDetailMarkdown(turn: Turn, isLive: boolean): string {
    const blocks = [...turnNotes(turn, isLive)];
    const derived = turnDerivationCacheRef.current.get(turn, mode, isLive && conversation.thinking);
    blocks.push(derived.markdown);

    if (isLive && conversation.pendingSteer !== undefined && conversation.pendingSteer !== "") {
      blocks.push(PENDING_STEER_NOTE);
    }
    if (turn.diagnostic !== undefined) {
      blocks.push(`> ⚠️ ${turn.diagnostic.message}`);
    }
    // O aviso de rede vive fora do turno: ele fala do acompanhamento, não da resposta.
    if (isLive && conversation.streamFailure !== undefined) {
      blocks.push("---", conversation.streamFailure.message);
    }
    if (showTechnical) {
      blocks.push(
        "---",
        technicalBlock({
          endpoint: conversation.baseUrl,
          runId: isLive ? conversation.runId : undefined,
          sessionId,
          detail: isLive ? conversation.streamFailure?.technical : undefined,
        }),
      );
    }
    return blocks.join("\n\n");
  }

  function renderTurn(turn: Turn): ReactElement {
    const isLive = turn.id === conversation.liveTurnId;
    const derived = turnDerivationCacheRef.current.get(turn, mode, isLive && conversation.thinking);
    const appearance = derived.appearance;
    const finished = isTurnFinished(turn);
    const duration =
      turn.finishedAt !== undefined && turn.startedAt !== undefined
        ? formatDuration(turn.finishedAt - turn.startedAt)
        : undefined;

    // §4.2: enquanto não terminal, o rótulo do estado; terminal e bem-sucedido, a duração.
    // Divergimos de propósito da recomendação de não usar acessórios com `isShowingDetail`:
    // sem eles a lista não diria qual turno está respondendo e qual terminou.
    // Terminar e terminar BEM são coisas diferentes: trocar o rótulo pela duração num turno
    // que falhou ou foi cancelado apagaria justamente a palavra que explica o que aconteceu,
    // e "12 s" ao lado de uma tarefa que morreu lê-se como sucesso.
    const wentWell =
      turn.expired !== true &&
      turn.error === undefined &&
      (turn.state.kind === "past" || (turn.state.kind === "live" && turn.state.status === "completed"));

    const accessories: List.Item.Accessory[] = [];
    if (!finished || !wentWell) {
      accessories.push({ tag: { value: appearance.label, color: appearance.color } });
    } else if (duration !== undefined) {
      accessories.push({ text: duration, tooltip: "Quanto tempo esta resposta levou" });
    }

    // Nomes das ferramentas usadas, extraídos das próprias linhas de Etapas (§6.3).
    const usedTools = derived.usedTools;

    return (
      <List.Item
        key={turn.id}
        id={turn.id}
        icon={statusImage(appearance)}
        title={derived.title}
        accessories={accessories}
        detail={
          <List.Item.Detail
            markdown={turnDetailMarkdown(turn, isLive)}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.TagList title="Estado">
                  <List.Item.Detail.Metadata.TagList.Item text={appearance.label} {...tagTone(appearance)} />
                </List.Item.Detail.Metadata.TagList>
                <List.Item.Detail.Metadata.Label title="Conversa" text={sessionTitle ?? NO_TITLE} />
                <List.Item.Detail.Metadata.Label title="Modelo" text={conversation.model ?? "Padrão do Hermes"} />
                <List.Item.Detail.Metadata.Label title="Sincronização" text="Aparece no Hermes Desktop" />
                {duration !== undefined ? <List.Item.Detail.Metadata.Label title="Duração" text={duration} /> : null}
                {mode === "etapas" && usedTools.length > 0 ? (
                  <List.Item.Detail.Metadata.TagList title="Etapas">
                    {usedTools.slice(0, 6).map((tool) => (
                      <List.Item.Detail.Metadata.TagList.Item key={tool} text={tool} />
                    ))}
                  </List.Item.Detail.Metadata.TagList>
                ) : null}
              </List.Item.Detail.Metadata>
            }
          />
        }
        actions={turnActions(turn)}
      />
    );
  }

  /* ────────────────────────── Erro que toma a tela ────────────────────────── */

  if (conversation.fatalError !== undefined) {
    const error: HermesError = conversation.fatalError;
    const technical = technicalBlock({
      endpoint: conversation.baseUrl,
      sessionId,
      detail: error.technical,
    });
    const failed = turns.find((turn) => turn.state.kind === "live" && turn.state.status === "failed");

    return (
      <List navigationTitle={COMMAND_TITLE} isLoading={false}>
        <List.EmptyView
          icon={Icon.Warning}
          title="Não foi possível perguntar"
          description={error.userMessage}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                {/* §5.2 E2: com a chave recusada, a PRIMEIRA ação é redetectar. `Tentar
                    novamente` com a mesma chave só repetiria o 401. */}
                {error.uxId === "E2" ? (
                  <AutoDetectAction onDone={() => (failed ? conversation.retry(failed.id) : undefined)} />
                ) : null}
                <Action
                  title="Tentar novamente"
                  icon={Icon.ArrowClockwise}
                  shortcut={SHORTCUTS.refresh}
                  onAction={() => (failed ? conversation.retry(failed.id) : undefined)}
                />
                <OpenPreferencesAction />
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
                  content={technical}
                  shortcut={SHORTCUTS.copyTechnical}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      </List>
    );
  }

  /* ────────────────────────────── A conversa ────────────────────────────── */

  const firstMessage = turns.find((turn) => turn.message !== "")?.message ?? "";
  const navigationTitle =
    sessionTitle ?? (firstMessage === "" ? COMMAND_TITLE : truncate(firstMessage, PROMPT_IN_TITLE));
  const recent: Session[] = sessions ?? [];
  const currentIsListed = sessionId !== undefined && recent.some((session) => session.id === sessionId);

  return (
    <List
      isLoading={conversation.isLoadingHistory || conversation.liveTurnId !== undefined}
      isShowingDetail={turns.length > 0}
      navigationTitle={navigationTitle}
      // Os itens são turnos, não resultados de busca: a barra é o campo de escrita.
      filtering={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={turns.length === 0 ? "Pergunte alguma coisa…" : "Pergunte outra coisa…"}
      selectedItemId={pinnedId}
      searchBarAccessory={
        <List.Dropdown
          key={dropdownNonce}
          tooltip="Conversa"
          value={sessionId ?? NEW_CONVERSATION}
          onChange={(value) => {
            const next = value === NEW_CONVERSATION ? undefined : value;
            void changeSession(
              next,
              recent.find((session) => session.id === next),
            );
          }}
        >
          <List.Dropdown.Item value={NEW_CONVERSATION} title="Nova conversa" icon={Icon.Plus} />
          {sessionId !== undefined && !currentIsListed ? (
            <List.Dropdown.Item
              value={sessionId}
              title={conversationDropdownLabel(sessionTitle ?? NO_TITLE, "")}
              icon={Icon.SpeechBubble}
            />
          ) : null}
          {recent.map((session) => (
            <List.Dropdown.Item
              key={session.id}
              value={session.id}
              icon={Icon.SpeechBubble}
              title={conversationDropdownLabel(session.title ?? NO_TITLE, formatRelative(session.last_active))}
            />
          ))}
        </List.Dropdown>
      }
    >
      {/* §4.4: o `actions` do próprio `List` só vale quando a lista não tem filhos. Sem o
          `EmptyView` carregando a ação de enviar, `Enter` não faria nada na conversa vazia. */}
      <List.EmptyView
        icon={conversation.isLoadingHistory ? Icon.SpeechBubble : { source: "cmd-ask-hermes.png" }}
        title={conversation.isLoadingHistory ? "Carregando a conversa" : "Comece a conversa"}
        description={
          conversation.isLoadingHistory
            ? "Buscando as mensagens desta conversa no Hermes."
            : `Escreva sua pergunta na barra acima e pressione Enter. ${SYNC_PROMISE}`
        }
        actions={turnActions()}
      />

      {conversation.historyFailed ? (
        <List.Item
          icon={Icon.Warning}
          title={HISTORY_FAILED_TITLE}
          subtitle="Você pode continuar escrevendo normalmente."
          detail={<List.Item.Detail markdown={HISTORY_FAILED_NOTE} />}
          actions={turnActions()}
        />
      ) : null}

      {conversation.hasOlder ? (
        <List.Item
          icon={Icon.ArrowUp}
          title="Carregar parte anterior da conversa"
          subtitle={`Traz as ${RENDER_TURN_LIMIT} trocas anteriores a estas.`}
          detail={
            <List.Item.Detail markdown={`Esta conversa tem mais trocas do que as ${turns.length} já mostradas.`} />
          }
          actions={
            <ActionPanel>
              {/* Só `Enviar` aqui: `Carregar parte anterior da conversa` já vem da seção da
                  conversa, com o mesmo `Ctrl+Shift+H`. Duas entradas iguais no mesmo painel
                  fazem o atalho parecer ambíguo e a lista de ações, descuidada. */}
              <ActionPanel.Section>{sendAction}</ActionPanel.Section>
              {conversationSection()}
              {diagnosticsSection()}
            </ActionPanel>
          }
        />
      ) : null}

      {turns.map(renderTurn)}
    </List>
  );
}
