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

import { Action, Icon, LaunchType, Toast, launchCommand, openExtensionPreferences, showToast } from "@raycast/api";
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

/** Abre o comando manifestado de modelos, mantendo a ação disponível em todas as telas. */
export function OpenModelsAction(): ReactElement {
  async function openModels(): Promise<void> {
    try {
      await launchCommand({ name: "models", type: LaunchType.UserInitiated });
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível abrir os modelos",
        message: 'Procure por "Modelos do Hermes" na busca do Raycast.',
      });
    }
  }

  return <Action title="Escolher modelo" icon={Icon.ComputerChip} onAction={() => void openModels()} />;
}

/*
 * NÃO adicione um `confirmAlert` a `Parar`.
 *
 * A UX-SPEC §6.6 item 6 é explícita: "Sem `confirmAlert`: parar é reversível no sentido em
 * que nada é destruído, e exigir confirmação atrasaria a única saída de emergência do
 * usuário." A regra geral do projeto ("confirmar toda ação irreversível") não se aplica
 * porque a spec declara que `Parar` não é destrutiva: o que já foi produzido continua
 * disponível e o estado terminal fica gravado. As três telas que oferecem `Parar`
 * (`ask`, `run-progress`, `active-runs`) chamam `stopRun()` direto.
 */
