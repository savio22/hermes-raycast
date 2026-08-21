/**
 * `Traduzir clipboard` — traduz o texto copiado.
 *
 * **Sem idioma configurado, e de propósito.** O par que este comando resolve no dia a dia é
 * português↔inglês, e qual dos dois é o destino depende do texto, não de uma preferência:
 * quem copiou um texto em inglês quer português, e quem copiou em português quer inglês.
 * Um idioma fixo nas preferências erraria metade das vezes, em silêncio. Quem quiser outro
 * idioma diz no argumento do comando, que é onde a exceção custa um segundo.
 */

import type { LaunchProps } from "@raycast/api";
import { type ReactElement } from "react";

import { TextCommand } from "./components/text-command";
import { buildUntrustedPrompt, inferTranslationDirection } from "./lib/input-safety";

const COMMAND_TITLE = "Traduzir clipboard";
const AUTO = [
  "Traduza o texto abaixo para português do Brasil.",
  "Se ele já estiver em português, traduza para inglês.",
].join(" ");
const TAIL = "Responda **apenas** com a tradução, sem comentário e sem repetir o texto original.";

type Arguments = { idioma?: string };

export default function Command(props: LaunchProps<{ arguments: Arguments }>): ReactElement {
  const language = (props.arguments?.idioma ?? "").trim();
  const instructionFor = (text: string): string => {
    if (language !== "") return `Traduza o texto abaixo para ${language}.`;
    const direction = inferTranslationDirection(text).direction;
    if (direction === "pt-en") return "Traduza o texto abaixo para inglês.";
    if (direction === "en-pt") return "Traduza o texto abaixo para português do Brasil.";
    return AUTO;
  };

  return (
    <TextCommand
      commandTitle={COMMAND_TITLE}
      source="area-de-transferencia"
      buildMessage={(text) => buildUntrustedPrompt(`${instructionFor(text)} ${TAIL}`, text)}
      confirmBeforeSend={(text) => {
        if (language !== "" || inferTranslationDirection(text).direction !== "ambiguous") return undefined;
        return {
          title: "Não identifiquei o idioma com segurança",
          description:
            "O texto é curto ou misto. Confirme para pedir a tradução automática, ou copie outro texto e tente novamente.",
        };
      }}
      emptyTitle="Não há nada copiado"
      emptyDescription="Copie o texto que você quer trabalhar (`Ctrl+C`) e chame este comando de novo."
    />
  );
}
