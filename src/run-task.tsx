/* eslint-disable @raycast/prefer-title-case -- a UX-SPEC §10.1 exige título de ação em
   frase, em pt-BR ("Copiar resposta", nunca "Copiar Resposta"); a regra é calibrada para o
   Title Case do inglês e `ray lint --fix` reescreve a copy do produto sem ela. */

/**
 * `Executar tarefa no Hermes` (UX-SPEC §2.4).
 *
 * A tela de entrada de uma tarefa longa. O motor é o de D-01, sem exceção:
 *
 *   POST /api/sessions {"source":"desktop","title":"<único>"}   ← `startConversation()`
 *   POST /v1/runs      {"input":…,"session_id":…}
 *
 * É esse par que faz a tarefa aparecer nos "Recentes" do Hermes Desktop e, ao mesmo tempo,
 * sobreviver ao fechamento da janela do Raycast (D-02, princípio 8 do brief).
 * `/v1/chat/completions` fica de fora de propósito (D-05).
 *
 * O formulário traz os cinco componentes da UX-SPEC §2.4.1 na ordem da spec, sem divulgação
 * progressiva: a escolha de modelo aqui vale SÓ para esta tarefa e não toca o padrão global
 * da extensão (brief §5, "override por tarefa").
 */

import {
  Action,
  ActionPanel,
  Form,
  Icon,
  LaunchType,
  Toast,
  launchCommand,
  openExtensionPreferences,
  showToast,
  useNavigation,
  type LaunchProps,
} from "@raycast/api";
import { useForm } from "@raycast/utils";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { NotConfigured } from "./components/first-run";
import { RunProgressView, shorten } from "./components/run-progress";
import { SHORTCUTS } from "./components/shortcuts";
import { resolveBaseUrl } from "./lib/discovery";
import { toHermesError } from "./lib/errors";
import { askInSession, flattenModelOptions, getModelOptions, listSessions, startConversation } from "./lib/hermes-api";
import { isConfigured } from "./lib/preferences";
import { CacheKeys, CacheTtl, cachedFetch, rememberRun } from "./lib/storage";
import type { ModelOption, Session } from "./lib/types";

/** Valor sentinela do primeiro item de cada dropdown; nunca vai para o servidor. */
const DEFAULT_MODEL_VALUE = "";
const NEW_CONVERSATION_VALUE = "new";

/** Quantas conversas recentes o dropdown oferece (UX-SPEC §2.4.1 item 5). */
const RECENT_SESSIONS = 5;

/** Recorte do prompt gravado no índice local — o suficiente para reconhecer o item. */
const PROMPT_PREVIEW_CHARS = 200;

interface TaskFormValues {
  tarefa: string;
  instrucoes: string;
  modelo: string;
  conversa: string;
}

type RunTaskArguments = { tarefa?: string };

export default function Command(
  props: LaunchProps<{ arguments: RunTaskArguments; draftValues: TaskFormValues }>,
): ReactElement {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void isConfigured().then((value) => {
      if (!cancelled) setConfigured(value);
    });
    return () => {
      cancelled = true;
    };
  }, [check]);

  // Guarda de configuração da UX-SPEC §2: sem chave, nenhuma requisição sai daqui.
  if (configured === false) {
    return <NotConfigured commandTitle="Executar tarefa no Hermes" onRetry={() => setCheck((value) => value + 1)} />;
  }

  return (
    <TaskForm
      isLoading={configured === undefined}
      initialTask={props.arguments?.tarefa ?? ""}
      draftValues={props.draftValues}
      enableDrafts
    />
  );
}

export interface TaskFormProps {
  initialTask?: string;
  /**
   * Rascunhos só funcionam quando o `Form` é a RAIZ do comando: numa view empilhada o
   * `draftValues` chegaria pelo `LaunchProps` do comando errado (UX-SPEC §2.1.1).
   */
  enableDrafts?: boolean;
  draftValues?: TaskFormValues;
  isLoading?: boolean;
}

export function TaskForm(props: TaskFormProps): ReactElement {
  const { push } = useNavigation();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  /**
   * Não existe `Idempotency-Key` em `/v1/runs` (04 §1.3): um segundo Enter antes do 202
   * criaria uma segunda tarefa. A trava é síncrona de propósito — `useState` só valeria
   * no render seguinte.
   */
  const submitting = useRef(false);
  const [isSending, setIsSending] = useState(false);

  const { handleSubmit, itemProps } = useForm<TaskFormValues>({
    onSubmit: (formValues) => {
      void submit(formValues);
    },
    initialValues: {
      tarefa: props.draftValues?.tarefa ?? props.initialTask ?? "",
      instrucoes: props.draftValues?.instrucoes ?? "",
      modelo: props.draftValues?.modelo ?? DEFAULT_MODEL_VALUE,
      conversa: props.draftValues?.conversa ?? NEW_CONVERSATION_VALUE,
    },
    validation: {
      // Mensagem própria em vez de `FormValidation.Required`, que responde em inglês.
      tarefa: (value) => (value === undefined || value.trim() === "" ? "Descreva a tarefa." : undefined),
    },
  });

  /* ── Modelos e conversas carregam em segundo plano e NUNCA bloqueiam o envio ── */
  useEffect(() => {
    let cancelled = false;
    void cachedFetch(CacheKeys.modelOptions, CacheTtl.modelOptions, () => getModelOptions())
      .then((payload) => {
        if (!cancelled) setModels(flattenModelOptions(payload).filter((option) => option.authenticated));
      })
      .catch(() => undefined);

    void listSessions({ limit: RECENT_SESSIONS })
      .then((page) => {
        if (!cancelled) setSessions(page.data.slice(0, RECENT_SESSIONS));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(formValues: TaskFormValues): Promise<void> {
    if (submitting.current) return;
    submitting.current = true;
    setIsSending(true);

    const task = formValues.tarefa.trim();
    const instructions = formValues.instrucoes.trim() === "" ? undefined : formValues.instrucoes.trim();
    const { provider, model } = splitModelValue(formValues.modelo);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Enviando ao Hermes…" });

    try {
      let sessionId: string;
      let sessionTitle: string | undefined;
      let runId: string;

      if (formValues.conversa === NEW_CONVERSATION_VALUE) {
        // D-01: sessão `source:"desktop"` primeiro, depois a run amarrada a ela. É o que
        // faz a tarefa existir nos "Recentes" do Hermes Desktop.
        const started = await startConversation({ input: task, instructions, model, provider });
        sessionId = started.sessionId;
        sessionTitle = started.title;
        runId = started.runId;
      } else {
        sessionId = formValues.conversa;
        sessionTitle = sessionTitleOf(sessions, sessionId);
        const created = await askInSession(sessionId, task, { instructions, model, provider });
        runId = created.run_id;
      }

      // Gravar ANTES de renderizar: não existe `GET /v1/runs`, então um run_id perdido
      // aqui é uma tarefa que o usuário nunca mais reencontra (armadilha 42).
      const { baseUrl } = await resolveBaseUrl();
      await rememberRun({
        runId,
        sessionId,
        promptPreview: task.slice(0, PROMPT_PREVIEW_CHARS),
        createdAt: Date.now(),
        lastKnownStatus: "queued",
        baseUrl,
      });

      await toast.hide();
      push(
        <RunProgressView
          runId={runId}
          prompt={task}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          model={model}
          // §2.1.4 / §6.1: **Preparando** desde o primeiro quadro. Sem semente a tela
          // mostraria `Estado: Desconhecido` até a primeira resposta do polling.
          status="queued"
          attachStream
          // UX-SPEC §2.4.2: a tarefa longa abre nas Etapas, não na Resposta.
          initialMode="etapas"
        />,
      );
    } catch (err) {
      const error = toHermesError(err, "run-task");
      toast.style = Toast.Style.Failure;
      toast.title = error.userMessage;
      if (error.recovery === "open_preferences") {
        toast.primaryAction = {
          title: "Abrir configurações",
          onAction: (current) => {
            void openExtensionPreferences();
            void current.hide();
          },
        };
      }
    } finally {
      submitting.current = false;
      setIsSending(false);
    }
  }

  return (
    <Form
      navigationTitle="Executar tarefa no Hermes"
      isLoading={props.isLoading === true || isSending}
      enableDrafts={props.enableDrafts === true}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSending ? "Enviando…" : "Executar tarefa"}
            icon={Icon.Play}
            onSubmit={handleSubmit}
          />
          <Action
            title="Ver tarefas em andamento"
            icon={Icon.List}
            shortcut={SHORTCUTS.activeRuns}
            onAction={() => void launchCommand({ name: "active-runs", type: LaunchType.UserInitiated })}
          />
          <Action
            title="Abrir configurações"
            icon={Icon.Gear}
            shortcut={SHORTCUTS.preferences}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        {...itemProps.tarefa}
        title="O que o Hermes deve fazer"
        placeholder="Descreva a tarefa com o máximo de detalhe possível."
        autoFocus
      />

      <Form.Separator />

      {/*
        Os cinco componentes da UX-SPEC §2.4.1, NESTA ordem e todos visíveis. A versão
        anterior escondia `Instruções extras`, `Modelo` e `Conversa` atrás de um checkbox
        "Mostrar opções avançadas" que a spec não prevê: as instruções que alimentam
        `instructions` de `POST /v1/runs` e a opção de rodar dentro de uma conversa
        existente ficavam invisíveis para quem abre a tela pela primeira vez.
      */}
      <Form.TextArea
        {...itemProps.instrucoes}
        title="Instruções extras"
        info="Opcional. Regras que valem só para esta tarefa, como tom, formato ou limites."
      />

      <Form.Dropdown
        {...itemProps.modelo}
        title="Modelo"
        info="Vale só para esta tarefa. O modelo padrão da extensão não muda."
      >
        <Form.Dropdown.Item value={DEFAULT_MODEL_VALUE} title="Padrão do Hermes" icon={Icon.Wand} />
        {models.map((option) => (
          <Form.Dropdown.Item
            key={`${option.provider}::${option.model}`}
            value={`${option.provider}::${option.model}`}
            title={option.model}
            keywords={[option.providerName]}
          />
        ))}
      </Form.Dropdown>

      <Form.Dropdown {...itemProps.conversa} title="Conversa">
        <Form.Dropdown.Item value={NEW_CONVERSATION_VALUE} title="Nova conversa" icon={Icon.Plus} />
        {sessions.map((session) => (
          <Form.Dropdown.Item
            key={session.id}
            value={session.id}
            title={shorten(session.title ?? "Sem título", 48)}
            icon={Icon.SpeechBubble}
          />
        ))}
      </Form.Dropdown>

      <Form.Description
        title="Sobre esta tarefa"
        text="A tarefa continua rodando no Hermes mesmo se você fechar o Raycast. Você pode acompanhar depois em Execuções do Hermes."
      />
    </Form>
  );
}

/* ────────────────────────────── Auxiliares puros ────────────────────────────── */

/** O dropdown guarda `provider::model`; o vazio significa "não mandar nada e usar o padrão". */
function splitModelValue(raw: string): { provider?: string; model?: string } {
  if (raw === DEFAULT_MODEL_VALUE) return {};
  const separator = raw.indexOf("::");
  if (separator < 0) return { model: raw };
  return { provider: raw.slice(0, separator), model: raw.slice(separator + 2) };
}

function sessionTitleOf(sessions: readonly Session[], sessionId: string): string {
  return sessions.find((session) => session.id === sessionId)?.title ?? "Sem título";
}
