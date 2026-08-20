/**
 * Fonte ÚNICA do vocabulário de estado em pt-BR (UX-SPEC §4).
 *
 * São exatamente 7 rótulos para exatamente 7 status do Hermes — nenhum status
 * mapeia para dois rótulos e nenhum rótulo tem dois status. Nenhum componente
 * pode montar rótulo por conta própria nem usar sinônimos ("Rodando",
 * "Em execução", "Finalizado", "Erro", "Abortado" são proibidos).
 *
 * As duas condições que NÃO são status ("Execução expirada" e "Sem conexão")
 * também moram aqui, para que ninguém seja tentado a chamá-las de "Falhou".
 */

import type { Color, Icon } from "@raycast/api";
import type { JobState, RunStatus } from "./types";

/* ───────────── Ícones e cores do Raycast, sem import de runtime ───────────── */

/**
 * `@raycast/api` não tem implementação em `node_modules` (o pacote publica só os
 * tipos e a CLI; o runtime é injetado pelo Raycast no build). Um import de VALOR
 * aqui tornaria este módulo — e todo módulo que o importa — impossível de carregar
 * sob `node --test`, que é a ferramenta de teste do projeto (D-07).
 *
 * A saída é usar o VALOR literal de cada membro dos enums, amarrado ao enum real
 * pelo tipo: `${(typeof Icon)["Clock"]}` resolve para "clock-16" em tempo de
 * compilação. Um nome de membro inexistente ou um valor que mude de string vira
 * erro de compilação, e no fio é exatamente o mesmo que `Icon.Clock` — enums de
 * string do TypeScript são apagados para a própria string.
 *
 * Os dois tipos abaixo aceitam um subconjunto dos membros do enum e amarram cada
 * chave ao valor real dele: nome inventado e valor errado não compilam.
 */
type IconMembers = { [K in keyof typeof Icon]?: `${(typeof Icon)[K]}` };
type ColorMembers = { [K in keyof typeof Color]?: `${Extract<(typeof Color)[K], string>}` };

const ICON = {
  Clock: "clock-16",
  CircleProgress: "circle-progress-16",
  Warning: "warning-16",
  Stop: "stop-16",
  CheckCircle: "check-circle-16",
  MinusCircle: "minus-circle-16",
  XMarkCircle: "x-mark-circle-16",
  QuestionMarkCircle: "question-mark-circle-16",
  WifiDisabled: "wifi-disabled-16",
  Circle: "circle-16",
} as const satisfies IconMembers;

/**
 * Só o neutro vem do Raycast. As cores com significado vêm de `HERMES`, abaixo: o
 * cinza secundário é o único que precisa acompanhar o texto secundário do próprio
 * Raycast, e por isso não pode ser um hex fixo.
 */
const COLOR = {
  SecondaryText: "raycast-secondary-text",
} as const satisfies ColorMembers;

/**
 * Uma cor do Raycast, ou uma cor própria com variante por tema.
 *
 * O formato do objeto é o `Color.Dynamic` do Raycast (`types/index.d.ts:1377`), aceito em
 * toda posição tipada como `Color.ColorLike` — `Image.tintColor` (`:5419`),
 * `accessory.tag.color` (`:5667`) e `Metadata.TagList.Item.color` (`:8399`). Ele NÃO é
 * aceito em `accessory.text.color` (`:5647`), `accessory.date.color` (`:5657`) nem
 * `Metadata.Label.text.color` (`:6102`), que exigem o enum. Todas as cores deste módulo
 * viajam por `statusImage()` até posições `ColorLike`, então o objeto é seguro aqui.
 */
export type Tint = `${Color}` | { readonly light: string; readonly dark: string; readonly adjustContrast?: boolean };

/**
 * A paleta do Hermes Desktop, em hex literal, para que a extensão tenha a mesma cor de
 * estado que o aplicativo. Valores conferidos em `apps/desktop/src/styles.css`: o bloco
 * claro em `:196-202` e o bloco `:root.dark` em `:517-551`, que sobrescreve SOMENTE
 * vermelho, verde e ciano — azul e amarelo são os mesmos nos dois temas, e por isso
 * aparecem repetidos aqui em vez de virarem string solta.
 *
 * `adjustContrast` fica omitido de propósito: o default é `true` (`:1394`) e é justamente
 * ele que garante contraste do azul do Hermes sobre o tema escuro do Raycast.
 */
const HERMES = {
  /** `--ui-blue` / `--theme-primary`: a cor da marca. Execução em andamento. */
  blue: { light: "#0053fd", dark: "#0053fd" },
  /**
   * Âmbar. Não vem de `--ui-*`: é o `bg-amber-500` de
   * `apps/desktop/src/app/chat/session-status-dot.tsx:34`, que o próprio Hermes descreve
   * como "a única cor 'aja agora', e o único estado sobre o qual o usuário é obrigado a
   * fazer algo" (`:30-32`) — exatamente "Aguardando aprovação". Tailwind 4.3.3 declara
   * `oklch(76.9% 0.188 70.08)` (`node_modules/tailwindcss/theme.css:39`), que em sRGB é
   * este hex.
   */
  amber: { light: "#fe9a00", dark: "#fe9a00" },
  /** `--ui-yellow`. Interrompendo: começou a parar, ainda não parou. */
  yellow: { light: "#c08532", dark: "#c08532" },
  /** `--ui-green`, com a variante escura de `:529`. */
  green: { light: "#1f8a65", dark: "#55a583" },
  /** `--ui-red`, com a variante escura de `:528`. Um vermelho só, para estado e para erro. */
  red: { light: "#cf2d56", dark: "#e75e78" },
} as const satisfies Record<string, Tint>;

/* ────────────────────────────── Vocabulário ────────────────────────────── */

/** Os 7 rótulos canônicos. Não criar sinônimos em lugar nenhum. */
export type StatusLabel =
  "Preparando" | "Executando" | "Aguardando aprovação" | "Interrompendo" | "Concluído" | "Cancelado" | "Falhou";

/** As 2 condições que não são estado de execução (UX-SPEC §4.3). */
export type ConditionLabel = "Execução expirada" | "Sem conexão";

/** Rótulo tolerante para um status que o servidor passe a emitir e ainda não conheçamos. */
export const UNKNOWN_STATUS_LABEL = "Desconhecido";

/** A dupla ícone+cor. A cor é o que carrega o significado à distância; ela nunca muda. */
export interface StatusAppearance {
  readonly icon: `${Icon}`;
  readonly color: Tint;
}

export interface LabeledAppearance extends StatusAppearance {
  readonly label: StatusLabel | ConditionLabel;
}

/* ───────────────────────── Status de execução (runs) ───────────────────────── */

/**
 * `satisfies Record<RunStatus, StatusLabel>` é o que torna o mapeamento total:
 * um literal novo em `RunStatus` (ou uma chave sobrando aqui) vira erro de
 * compilação, nunca um rótulo silenciosamente ausente.
 */
export const RUN_STATUS_LABEL = {
  queued: "Preparando",
  running: "Executando",
  waiting_for_approval: "Aguardando aprovação",
  stopping: "Interrompendo",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Falhou",
} as const satisfies Record<RunStatus, StatusLabel>;

/** Ícone e cor de cada status (UX-SPEC §4.1). Mesma totalidade da tabela de rótulos. */
export const RUN_STATUS_APPEARANCE = {
  queued: { icon: ICON.Clock, color: COLOR.SecondaryText },
  running: { icon: ICON.CircleProgress, color: HERMES.blue },
  waiting_for_approval: { icon: ICON.Warning, color: HERMES.amber },
  stopping: { icon: ICON.Stop, color: HERMES.yellow },
  completed: { icon: ICON.CheckCircle, color: HERMES.green },
  cancelled: { icon: ICON.MinusCircle, color: COLOR.SecondaryText },
  failed: { icon: ICON.XMarkCircle, color: HERMES.red },
} as const satisfies Record<RunStatus, StatusAppearance>;

/**
 * Segunda prova, redundante de propósito: se `RunStatus` ganhar um literal que
 * as duas tabelas não cobrirem, `Exclude<...>` deixa de ser `never` e isto não
 * compila. Custo zero em runtime (é só tipo).
 */
type EnsureNever<T extends never> = T;
export type RunStatusCoverage = EnsureNever<
  Exclude<RunStatus, keyof typeof RUN_STATUS_LABEL & keyof typeof RUN_STATUS_APPEARANCE>
>;

/** Terminal = o servidor não mexe mais nesta run. `stopping` NÃO é terminal. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>(["completed", "cancelled", "failed"]);

export function isTerminalRunStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_RUN_STATUSES.has(status);
}

/** Tolerante a status futuros desconhecidos: nunca inventa um dos 7 rótulos. */
export function runStatusLabel(status: string | undefined): string {
  if (status !== undefined && status in RUN_STATUS_LABEL) {
    return RUN_STATUS_LABEL[status as RunStatus];
  }
  return UNKNOWN_STATUS_LABEL;
}

/** Par ícone+cor tolerante. No desconhecido usa o neutro, nunca vermelho. */
export function runStatusAppearance(status: string | undefined): StatusAppearance {
  if (status !== undefined && status in RUN_STATUS_APPEARANCE) {
    return RUN_STATUS_APPEARANCE[status as RunStatus];
  }
  return { icon: ICON.Circle, color: COLOR.SecondaryText };
}

/* ──────────── As duas condições que não são status (UX-SPEC §4.3) ──────────── */

/**
 * `GET /v1/runs/{id}` devolveu 404 `run_not_found`: o gateway reiniciou ou passou
 * o TTL de 1 hora. É condição de item de lista, não estado de execução.
 * PROIBIDO mapear para "Falhou" ou "Cancelado" — seria mentira.
 */
export const RUN_EXPIRED = {
  label: "Execução expirada",
  icon: ICON.QuestionMarkCircle,
  color: COLOR.SecondaryText,
} as const satisfies LabeledAppearance;

/** Texto de detalhe da execução expirada (literal da UX-SPEC §4.3). */
export const RUN_EXPIRED_DETAIL =
  "O Hermes não tem mais informação sobre esta tarefa. Ela pode ter terminado normalmente.";

/** Condição do cliente, não do servidor: só aparece em cabeçalho de erro. */
export const NO_CONNECTION = {
  label: "Sem conexão",
  icon: ICON.WifiDisabled,
  color: HERMES.red,
} as const satisfies LabeledAppearance;

/* ─────────────── Fase do turno em /api/sessions/{id}/chat/stream ─────────────── */

/**
 * Mesmo vocabulário dos 7 rótulos, aplicado ao stream de conversa.
 * Transições: idle → run.started ⇒ running → error ⇒ failed → done ⇒ completed.
 */
export type StreamPhase = "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";

export const STREAM_PHASE_LABEL = {
  idle: "Preparando",
  running: "Executando",
  stopping: "Interrompendo",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Falhou",
} as const satisfies Record<StreamPhase, StatusLabel>;

/* ─────────────────────────── Estado de automação ─────────────────────────── */

/** Vocabulário próprio dos jobs (UX-SPEC §1.2); não se mistura com os 7 de run. */
export const JOB_STATE_LABEL = {
  scheduled: "Agendado",
  paused: "Pausado",
  completed: "Concluído",
  error: "Falhou",
} as const satisfies Record<JobState, string>;

export function jobStateLabel(state: string | undefined): string {
  if (state !== undefined && state in JOB_STATE_LABEL) {
    return JOB_STATE_LABEL[state as JobState];
  }
  return UNKNOWN_STATUS_LABEL;
}
