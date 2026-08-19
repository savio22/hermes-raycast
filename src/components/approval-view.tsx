/* eslint-disable @raycast/prefer-title-case -- os títulos de ação são literais em pt-BR da
   UX-SPEC §7.4 ("Aprovar só esta vez", "Negar"); Title Case os desfiguraria. */

/**
 * Tela de aprovação (UX-SPEC §7) — a superfície de segurança da extensão.
 *
 * Quatro invariantes, nesta ordem de importância:
 *
 * 1. **Nunca aprovar automaticamente.** Não existe preferência, "lembrar minha escolha" nem
 *    aprovação em lote. `rememberUserChoice` é sempre `false`.
 * 2. **Nunca inventar informação.** O evento `approval.request` traz `command`, `description`,
 *    `pattern_key(s)`, `request_id` e `choices` — e **não** traz `tool_name` nem `args`
 *    (desvio D5). Rotular a ação com um nome de ferramenta deduzido é proibido.
 * 3. **As opções vêm do servidor.** Renderizamos exatamente o array `choices` recebido, na
 *    ordem em que veio (armadilha 25). Nada de lista fixa.
 * 4. **A fila é FIFO e não endereçável** (armadilha 23): o `request_id` só correlaciona; o
 *    POST resolve o pedido mais antigo. Por isso o aviso da §7.5 quando há mais de um.
 *
 * Fica em `components/` porque `Execuções do Hermes` responde aprovações pela mesma tela.
 */

import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Detail,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
  type Keyboard,
} from "@raycast/api";
import { useRef, useState } from "react";
import { hermesDesktopSessionUrl } from "../lib/discovery";
import { toHermesError } from "../lib/errors";
import { respondToApproval, stopRun } from "../lib/hermes-api";
import { runStatusLabel } from "../lib/status";
import type { ApprovalChoice, ApprovalRequestFields } from "../lib/types";
import { SHORTCUTS } from "./shortcuts";

/**
 * §7.3 — padrões conhecidamente destrutivos. A lista literal vem da UX-SPEC; as quatro
 * palavras soltas cobrem chaves novas que o servidor venha a emitir.
 */
const DESTRUCTIVE_PATTERN_KEYS: ReadonlySet<string> = new Set([
  "rm-rf",
  "del",
  "format",
  "drop",
  "truncate",
  "shutdown",
  "reg-delete",
  "git-push-force",
]);
const DESTRUCTIVE_HINTS = ["delete", "remove", "destroy", "force"];

export function isDestructive(patternKeys: readonly string[]): boolean {
  return patternKeys.some((key) => {
    const value = key.toLowerCase();
    return DESTRUCTIVE_PATTERN_KEYS.has(value) || DESTRUCTIVE_HINTS.some((hint) => value.includes(hint));
  });
}

const RISK_DESTRUCTIVE =
  "> ⛔ **Ação destrutiva.** Este comando pode apagar ou sobrescrever arquivos de forma definitiva. Só aprove se você entende exatamente o que ele faz.";
const RISK_SENSITIVE =
  "> ⚠️ **Ação sensível.** Este comando pode alterar arquivos ou executar programas no seu computador.";
const RISK_SMART_DENIED = "> 🛑 **O Hermes recomendou negar esta ação.** Aprovar vale só para esta única vez.";

/**
 * Cerca de código maior que a maior sequência de crases do conteúdo.
 *
 * `command` é texto escolhido pelo modelo e influenciável por injeção no material que o
 * agente leu. Com uma cerca fixa de três crases, um comando contendo ``` fecha o bloco e o
 * resto vira Markdown vivo — na ÚNICA tela cuja função é o usuário julgar o que autoriza.
 * Daria para empurrar o bloco de risco real para fora da dobra, forjar um `> ✅` no mesmo
 * estilo e inserir um link clicável dentro do diálogo de permissão.
 */
function codeFence(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * `description` vai em PROSA, então não há cerca protegendo-a: uma quebra de linha sai do
 * parágrafo e `#`, `>` ou `[texto](url)` viram estrutura. Colapsamos para uma linha e
 * escapamos os marcadores de início de linha; o texto continua legível e literal.
 */
function inlineText(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").replace(/^([#>\-*+])/, "\\$1");
}

const TIMEOUT_NOTE =
  "O Hermes está parado esperando sua resposta. Se ninguém responder, ele desiste sozinho depois de alguns minutos.";

const DETAILS_LOST = `# Aprovação pendente

O Hermes está esperando uma resposta sua para continuar, mas os detalhes do pedido se perderam quando o Raycast foi fechado.

Sem ver o comando, a escolha segura é negar. Você pode pedir a tarefa de novo e deixar o Raycast aberto para ver o pedido completo.
`;

export interface ApprovalViewProps {
  runId: string;
  fields: ApprovalRequestFields;
  /** Quantos pedidos estão na fila desta tarefa (§7.5). */
  pendingCount: number;
  /** `true` quando o payload se perdeu com a janela fechada (§7.6). */
  detailsLost: boolean;
  /** Primeiros 60 caracteres do pedido do usuário — metadata "Tarefa". */
  taskPreview: string;
  conversationTitle: string;
  sessionId?: string;
  /** Chamado depois do POST, com quantos pedidos o servidor resolveu de uma vez. */
  onResolved: (choice: ApprovalChoice, resolved: number) => void;
  /**
   * `Ver etapas da tarefa` (`Ctrl+T`, §7.4). Quem chama decide o que "ver as etapas"
   * significa na sua pilha de navegação: voltar para a tela da execução em modo Etapas
   * (`ask`, `run-progress`) ou abri-la por cima (`Execuções do Hermes`).
   */
  onShowSteps?: () => void;
}

interface ChoiceSpec {
  title: string;
  icon: Icon;
  shortcut?: Keyboard.Shortcut;
  style?: Action.Style;
  confirm?: Alert.Options;
}

/** §7.4 — título, atalho, estilo e confirmação de cada `choice` que o servidor pode mandar. */
const CHOICE_SPECS: Record<ApprovalChoice, ChoiceSpec> = {
  once: {
    title: "Aprovar só esta vez",
    icon: Icon.Check,
    // Sem atalho: é a ação primária (Enter) quando o servidor a oferece primeiro.
  },
  session: {
    title: "Aprovar durante esta execução",
    icon: Icon.Clock,
    shortcut: SHORTCUTS.approveSession,
    confirm: {
      title: "Aprovar durante toda esta execução?",
      message: "O Hermes vai poder repetir comandos parecidos até esta tarefa terminar, sem perguntar de novo.",
      primaryAction: { title: "Aprovar durante esta execução", style: Alert.ActionStyle.Default },
      dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
    },
  },
  always: {
    title: "Aprovar sempre este tipo de comando",
    icon: Icon.ExclamationMark,
    shortcut: SHORTCUTS.approveAlways,
    style: Action.Style.Destructive,
    confirm: {
      title: "Aprovar sempre este tipo de comando?",
      message:
        "Comandos parecidos com este passam a ser executados sem pedir sua permissão, agora e no futuro, em qualquer conversa. A regra vale para o padrão do comando, não só para este texto exato. Você pode desfazer isso no Hermes Desktop.",
      primaryAction: { title: "Aprovar sempre", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
      // Uma confirmação lembrada anularia a própria confirmação (§7.4).
      rememberUserChoice: false,
    },
  },
  deny: {
    title: "Negar",
    icon: Icon.XMarkCircle,
    shortcut: SHORTCUTS.deny,
  },
};

function buildMarkdown(props: ApprovalViewProps): string {
  const { fields, pendingCount, detailsLost } = props;
  const patternKeys = [...(fields.pattern_keys ?? []), ...(fields.pattern_key ? [fields.pattern_key] : [])];

  const queueWarning =
    pendingCount > 1
      ? `\n> Existem ${pendingCount} pedidos de aprovação nesta tarefa. Sua resposta vale para o mais antigo deles.\n`
      : "";

  if (detailsLost) return `${DETAILS_LOST}${queueWarning}\n${TIMEOUT_NOTE}\n`;

  const risk =
    fields.smart_denied === true ? RISK_SMART_DENIED : isDestructive(patternKeys) ? RISK_DESTRUCTIVE : RISK_SENSITIVE;

  const command = fields.command ?? "(o Hermes não informou o comando)";
  const fence = codeFence(command);
  const description =
    fields.description === undefined ? "o Hermes não explicou o motivo." : inlineText(fields.description);

  return `# O Hermes precisa da sua permissão

Ele quer executar este comando no seu computador:

${fence}
${command}
${fence}

**Por que estamos perguntando:** ${description}

${risk}

Se você não reconhece este comando ou não pediu nada parecido, escolha **Negar**.
${queueWarning}
${TIMEOUT_NOTE}
`;
}

export function ApprovalView(props: ApprovalViewProps) {
  const { runId, fields, detailsLost, taskPreview, conversationTitle, sessionId, onResolved, onShowSteps } = props;
  const { pop } = useNavigation();
  /**
   * Trava SÍNCRONA. `useState` só valeria no render seguinte, e a fila de aprovações é
   * FIFO e não endereçável (armadilha 23): dois Enter rápidos mandariam dois POST e o
   * segundo resolveria o PRÓXIMO pedido, que o usuário nunca viu.
   */
  const responding = useRef(false);
  const [isResponding, setIsResponding] = useState(false);

  const desktopUrl = hermesDesktopSessionUrl(sessionId);
  const patternKey = fields.pattern_key ?? fields.pattern_keys?.[0];

  async function respond(choice: ApprovalChoice, confirmation?: Alert.Options): Promise<void> {
    if (responding.current) return;
    if (confirmation && !(await confirmAlert(confirmation))) return;

    responding.current = true;
    setIsResponding(true);
    try {
      const response = await respondToApproval(runId, choice);
      onResolved(choice, response.resolved);
      await showToast({
        style: Toast.Style.Success,
        title: choice === "deny" ? "Negado. O Hermes vai seguir sem essa ação." : "Aprovado. O Hermes vai continuar.",
        // A API resolve a fila inteira quando os pedidos são equivalentes (§7.5).
        message: response.resolved > 1 ? `${response.resolved} pedidos foram respondidos de uma vez.` : undefined,
      });
      pop();
    } catch (err) {
      const hermes = toHermesError(err, `POST /v1/runs/${runId}/approval`);
      // E12: já respondido em outro aplicativo — a tela volta, não insiste.
      await showToast({ style: Toast.Style.Failure, title: hermes.userMessage });
      responding.current = false;
      setIsResponding(false);
    }
  }

  /** §6.6 item 6: `Parar` não tem `confirmAlert` — é a saída de emergência. */
  async function stop(): Promise<void> {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Parando a tarefa…" });
    try {
      await stopRun(runId);
      toast.style = Toast.Style.Success;
      toast.title = "Tarefa parada";
      pop();
    } catch (err) {
      const hermes = toHermesError(err, `POST /v1/runs/${runId}/stop`);
      // Armadilha 21: 404 aqui significa "a tarefa já tinha terminado", nunca erro.
      if (hermes.httpStatus === 404) {
        toast.style = Toast.Style.Success;
        toast.title = "Tarefa parada";
        pop();
        return;
      }
      toast.style = Toast.Style.Failure;
      toast.title = hermes.userMessage;
    }
  }

  // Exatamente o array do servidor, na ordem recebida (armadilha 25). Um `choice` que não
  // conhecemos é ignorado: sem rótulo confiável, botão nenhum. O `?? []` é defesa contra o
  // fio: `choices` chega de um cast do frame do stream, sem validação de forma, e um
  // `undefined` aqui derrubaria a tela — deixando o usuário sem conseguir nem negar.
  const offered = detailsLost
    ? (["deny"] as ApprovalChoice[])
    : (fields.choices ?? []).filter((c) => c in CHOICE_SPECS);

  return (
    <Detail
      navigationTitle="Aprovação necessária"
      isLoading={isResponding}
      markdown={buildMarkdown(props)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Tarefa" text={taskPreview} />
          <Detail.Metadata.Label title="Conversa" text={conversationTitle} />
          <Detail.Metadata.Label title="Estado" text={runStatusLabel("waiting_for_approval")} />
          {/* `pattern_key` cru de propósito: é o identificador confiável do tipo de bloqueio. */}
          {patternKey ? <Detail.Metadata.Label title="Tipo de bloqueio" text={patternKey} /> : null}
          {fields.request_id ? (
            <Detail.Metadata.Label title="Identificador" text={fields.request_id.slice(0, 8)} />
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {offered.map((choice) => {
              const spec = CHOICE_SPECS[choice];
              return (
                <Action
                  key={choice}
                  title={spec.title}
                  icon={spec.icon}
                  style={spec.style}
                  shortcut={spec.shortcut}
                  onAction={() => void respond(choice, spec.confirm)}
                />
              );
            })}
            {detailsLost ? (
              /* Decisão P4: a UX-SPEC §7.6 mantém a saída de emergência, atrás de um alerta
                 destrutivo e com `Negar` como ação primária. Se P4 for negada, remova esta ação. */
              <Action
                title="Aprovar mesmo sem ver os detalhes"
                icon={Icon.ExclamationMark}
                style={Action.Style.Destructive}
                shortcut={SHORTCUTS.approveSession}
                onAction={() =>
                  void respond("once", {
                    title: "Aprovar sem ver o comando?",
                    message:
                      "Você vai autorizar um comando que não está sendo exibido. Só faça isso se tiver certeza do que pediu ao Hermes.",
                    primaryAction: { title: "Aprovar", style: Alert.ActionStyle.Destructive },
                    dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
                    rememberUserChoice: false,
                  })
                }
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section>
            {fields.command ? (
              <Action.CopyToClipboard title="Copiar comando" content={fields.command} shortcut={SHORTCUTS.copy} />
            ) : null}
            {/* §7.4: `Ver etapas da tarefa` faz parte da tabela de ações desta tela. */}
            {onShowSteps !== undefined ? (
              <Action
                title="Ver etapas da tarefa"
                icon={Icon.List}
                shortcut={SHORTCUTS.toggleSteps}
                onAction={onShowSteps}
              />
            ) : null}
            {/* §7.6: com os detalhes perdidos, parar a tarefa é uma das saídas oferecidas. */}
            {detailsLost ? (
              <Action
                title="Parar tarefa"
                icon={Icon.Stop}
                style={Action.Style.Destructive}
                shortcut={SHORTCUTS.stop}
                onAction={() => void stop()}
              />
            ) : null}
            {desktopUrl ? (
              <Action.Open
                title="Abrir no Hermes Desktop"
                icon={Icon.Desktop}
                target={desktopUrl}
                shortcut={SHORTCUTS.openInDesktop}
              />
            ) : null}
            {/* §5.1 regra 3 / §9.2: `Abrir configurações` existe em TODA tela. */}
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
