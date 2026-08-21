/**
 * `Resumir clipboard` — resume o texto copiado, sem tela intermediária.
 *
 * A instrução pede tópicos porque é o formato que sobrevive à leitura de relance no painel
 * da conversa; um parágrafo corrido exigiria ler tudo para achar o que interessa.
 */

import { type ReactElement } from "react";

import { TextCommand } from "./components/text-command";
import { buildUntrustedPrompt } from "./lib/input-safety";

const COMMAND_TITLE = "Resumir clipboard";
const INSTRUCTION = [
  "Resuma o texto abaixo em português do Brasil.",
  "Comece por uma frase que diga do que se trata e siga com até 5 tópicos com o que importa.",
  "Não invente nada que não esteja no texto.",
].join(" ");

export default function Command(): ReactElement {
  return (
    <TextCommand
      commandTitle={COMMAND_TITLE}
      source="area-de-transferencia"
      buildMessage={(text) => buildUntrustedPrompt(INSTRUCTION, text)}
      emptyTitle="Não há nada copiado"
      emptyDescription="Copie o texto que você quer trabalhar (`Ctrl+C`) e chame este comando de novo."
    />
  );
}
