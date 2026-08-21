/** Copy shared by the approval detail and its recovery state. */

import { type PlatformCopy, platformCopy } from "./platform";

/** A tecla que abre o painel de ações é a do sistema: `Ctrl+K` no Windows, `Cmd+K` no macOS. */
export function approvalActionHint(copy: PlatformCopy = platformCopy()): string {
  return `As escolhas ficam em Actions (${copy.actionsKeys}); use o painel para responder ao pedido.`;
}

export function approvalDetailsLostHint(): string {
  return "Os detalhes do pedido se perderam quando o Raycast foi fechado. Sem ver o comando, escolha Negar.";
}
