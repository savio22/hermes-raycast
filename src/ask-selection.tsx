/**
 * `Perguntar sobre seleção` — pega o texto selecionado (ou o que estiver copiado) e abre a
 * conversa já perguntando sobre ele.
 *
 * O argumento `pergunta` é o que muda entre "o que é isto?" e uma pergunta de verdade. Sem
 * ele, a pergunta padrão é deliberadamente aberta: quem aciona este comando sobre um trecho
 * quase sempre quer entender o trecho.
 */

import type { LaunchProps } from "@raycast/api";
import { type ReactElement } from "react";

import { TextCommand } from "./components/text-command";
import { buildUntrustedPrompt } from "./lib/input-safety";

const COMMAND_TITLE = "Perguntar sobre seleção";
const DEFAULT_QUESTION = "Explique este texto em português, de forma simples e direta.";

type Arguments = { pergunta?: string };

export default function Command(props: LaunchProps<{ arguments: Arguments }>): ReactElement {
  const question = (props.arguments?.pergunta ?? "").trim();

  return (
    <TextCommand
      commandTitle={COMMAND_TITLE}
      source="selecao"
      buildMessage={(text) => buildUntrustedPrompt(question === "" ? DEFAULT_QUESTION : question, text)}
      emptyTitle="Não achei texto nenhum"
      emptyDescription={[
        "Selecione um trecho na janela em que você estava, ou copie o texto, e chame este comando de novo.",
        "",
        "No Windows, muitos aplicativos não entregam a seleção ao sistema. Quando isso acontece, copiar (`Ctrl+C`) sempre funciona.",
      ].join("\n")}
    />
  );
}
