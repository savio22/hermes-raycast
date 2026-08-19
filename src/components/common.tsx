/* eslint-disable @raycast/prefer-title-case -- a UX-SPEC §10.1 exige título de ação em
   frase, em pt-BR ("Copiar resposta", nunca "Copiar Resposta"); a regra é calibrada para o
   Title Case do inglês e `ray lint --fix` reescreve a copy do produto sem ela. */

/**
 * As poucas peças que TODA tela usa e que não podem divergir entre comandos.
 *
 * Existe porque quatro telas foram escritas em paralelo e cada uma redigitou a frase da
 * sincronia e a ação `Abrir configurações`. Um literal da UX-SPEC copiado em cinco arquivos
 * é um literal que vai divergir na primeira revisão de texto: aqui ele tem um dono só.
 */

import { Action, Alert, Icon, confirmAlert, openExtensionPreferences } from "@raycast/api";
import type { ReactElement } from "react";
import { SHORTCUTS } from "./shortcuts";

/** UX-SPEC §10.3 — frase canônica da sincronia, usada sem variação. */
export const SYNC_PROMISE = "Suas conversas do Raycast também aparecem no Hermes Desktop.";

/** Nome exibido de uma conversa sem título. */
export const NO_TITLE = "Sem título";

/** §5.1 regra 3: `Abrir configurações` está em toda tela, sempre com o mesmo atalho. */
export function OpenPreferencesAction(): ReactElement {
  return (
    <Action
      title="Abrir configurações"
      icon={Icon.Gear}
      shortcut={SHORTCUTS.preferences}
      onAction={openExtensionPreferences}
    />
  );
}

/**
 * `Parar` é a única ação da extensão que cancela trabalho no servidor e não tem desfazer.
 * A UX-SPEC §6.6.6 dispensava a confirmação; a regra deste projeto exige `confirmAlert` em
 * toda ação irreversível, e ela vale igual nas três telas que oferecem `Parar` — por isso
 * o alerta mora aqui, e não copiado em cada uma com uma frase um pouco diferente.
 */
export async function confirmStopRun(): Promise<boolean> {
  return confirmAlert({
    icon: Icon.Stop,
    title: "Parar esta tarefa?",
    message: "O Hermes encerra o que está fazendo agora. O que já foi produzido continua disponível.",
    primaryAction: { title: "Parar", style: Alert.ActionStyle.Destructive },
    dismissAction: { title: "Cancelar", style: Alert.ActionStyle.Cancel },
    // Uma confirmação lembrada transformaria um destrutivo em um destrutivo silencioso.
    rememberUserChoice: false,
  });
}
