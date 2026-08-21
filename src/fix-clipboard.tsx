/**
 * `Corrigir texto do clipboard` — corrige o texto copiado e devolve só o texto corrigido.
 *
 * A instrução proíbe comentário de propósito: quem usa este comando quer colar o resultado
 * no lugar do original (`Ctrl+Shift+V`, dentro da conversa), e um "aqui está a versão
 * corrigida:" antes do texto teria de ser apagado à mão toda vez.
 */

import { type ReactElement } from "react";

import { TextCommand } from "./components/text-command";
import { buildUntrustedPrompt } from "./lib/input-safety";

const COMMAND_TITLE = "Corrigir texto do clipboard";
const INSTRUCTION = [
  "Corrija ortografia, gramática e pontuação do texto abaixo, preservando o sentido, o tom e o idioma original.",
  "Responda **apenas** com o texto corrigido, sem comentário, sem explicação e sem aspas em volta.",
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
