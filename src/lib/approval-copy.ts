/** Copy shared by the approval detail and its recovery state. */

export function approvalActionHint(): string {
  return "As escolhas ficam em Actions (Ctrl+K); use o painel para responder ao pedido.";
}

export function approvalDetailsLostHint(): string {
  return "Os detalhes do pedido se perderam quando o Raycast foi fechado. Sem ver o comando, escolha Negar.";
}
