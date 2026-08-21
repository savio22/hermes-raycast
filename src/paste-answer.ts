/**
 * `Colar última resposta` — o único comando `no-view` da extensão.
 *
 * Efeito colateral puro: lê o índice local de execuções, acha a resposta mais recente que
 * tenha texto, e cola no aplicativo que está na frente. Nada a exibir, então nada de tela —
 * é a exceção que a UX-SPEC §1.2 já previa.
 *
 * **Não fala com o Hermes.** Tudo sai do `LocalStorage`, o que faz este comando funcionar
 * mesmo com o Hermes desligado e o torna instantâneo — que é o ponto: quem chama isto está
 * com o cursor num campo de texto, esperando.
 *
 * Por isso ele também **não** tem guarda de configuração: sem chave nunca houve resposta
 * para colar, e o estado vazio já diz exatamente isso.
 */

import { Clipboard, Toast, showHUD, showToast } from "@raycast/api";

import { listStoredRuns, loadRunResult } from "./lib/storage";

/** Quantas execuções recentes vasculhar antes de desistir. O índice guarda no máximo 20. */
const MAX_LOOKBACK = 20;

export default async function Command(): Promise<void> {
  // `createdAt` decrescente já é a ordem do índice (`rememberRun` insere na frente), mas
  // ordenar aqui deixa o comando correto mesmo se o índice for remontado de outro jeito.
  const runs = (await listStoredRuns()).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LOOKBACK);

  for (const run of runs) {
    const result = await loadRunResult(run.runId);
    const answer = result?.output?.trim();
    if (answer === undefined || answer === "") continue;

    await Clipboard.paste(answer);
    await showHUD("Resposta colada");
    return;
  }

  await showToast({
    style: Toast.Style.Failure,
    title: "Ainda não há resposta para colar",
    message: "Pergunte alguma coisa ao Hermes e o resultado fica disponível aqui por 24 horas.",
  });
}
