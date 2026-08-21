import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "./helpers/module-hooks.mjs";

const { compactConversationCount, compactMessageCount, compactModelLabel, conversationDropdownLabel, truncateOneLine } =
  await import("../src/lib/ui-text.ts");
const { approvalActionHint, approvalDetailsLostHint } = await import("../src/lib/approval-copy.ts");

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as {
  commands: Array<{ name: string; title: string; description?: string; keywords?: string[] }>;
};
const shortcutsSource = readFileSync(`${root}/src/components/shortcuts.ts`, "utf8");
const commonSource = readFileSync(`${root}/src/components/common.tsx`, "utf8");
const approvalSource = readFileSync(`${root}/src/components/approval-view.tsx`, "utf8");
const activeRunsSource = readFileSync(`${root}/src/active-runs.tsx`, "utf8");

function command(name: string) {
  const found = packageJson.commands.find((item) => item.name === name);
  assert.ok(found, `comando ${name} precisa continuar registrado`);
  return found;
}

test("texto de lista vira uma linha e não separa emoji ao truncar", () => {
  assert.equal(truncateOneLine("  título\ncom\tquebra  ", 12), "título com…");

  const shown = truncateOneLine("🌱 irrigação muito longa", 10);
  assert.equal(shown, "🌱 irriga…");
  assert.equal(/\uD800|\uDFFF/.test(shown), false);

  const developer = truncateOneLine("👩‍💻 desenvolve no Hermes", 4);
  assert.equal(developer.startsWith("👩‍💻"), true);
  assert.equal(developer.startsWith("👩‍…"), false);
});

test("contadores e rótulos do seletor ficam compactos sem perder a data", () => {
  assert.equal(compactMessageCount(1), "1 msg");
  assert.equal(compactMessageCount(12), "12 msgs");
  assert.equal(compactMessageCount(0), "0 msgs");
  assert.equal(compactConversationCount(1), "1 conversa");
  assert.equal(compactConversationCount(12), "12 conversas");

  const label = conversationDropdownLabel("Uma conversa com um título muito, muito comprido", "há 2 h");
  assert.equal(label.endsWith(" · há 2 h"), true);
  assert.equal(Array.from(label).length <= 56, true);
});

test("modelo da linha usa rótulo compacto sem perder o valor completo no tooltip", () => {
  const model = "anthropic/claude-sonnet-4-20250514";
  assert.equal(compactModelLabel(model), "anthropic/claude-sonnet…");
  assert.equal(compactModelLabel("gpt-5"), "gpt-5");
});

test("atalhos Windows mantêm Nova conversa em Ctrl+N e etapas em Ctrl+T", () => {
  assert.match(shortcutsSource, /newConversation:\s*Keyboard\.Shortcut\.Common\.New/);
  assert.match(shortcutsSource, /toggleSteps:\s*\{ modifiers: \["ctrl"\], key: "t" \}/);
  assert.doesNotMatch(shortcutsSource, /newConversation:\s*\{[^}]*key:\s*["']t["']/s);
});

test("a repetição de uma execução deixa claro que é uma tarefa, não uma conversa", () => {
  assert.match(activeRunsSource, /title="Executar esta tarefa novamente"/);
  assert.doesNotMatch(activeRunsSource, /title="Perguntar de novo"/);
});

test("manifesto expõe comandos úteis por nomes e palavras que o usuário procura", () => {
  assert.equal(command("models").title, "Modelos do Hermes");
  assert.match(command("models").description ?? "", /atalhos.*configurações do Raycast/i);
  assert.deepEqual(
    ["escolher modelo", "trocar modelo"].every((word) => command("models").keywords?.includes(word)),
    true,
  );
  assert.deepEqual(
    [
      "pendentes",
      "tarefas pendentes",
      "tarefas em execução",
      "aguardando aprovação",
      "aprovação pendente",
      "aprovações",
    ].every((word) => command("active-runs").keywords?.includes(word)),
    true,
  );
  assert.deepEqual(command("ask-hermes").keywords?.includes("nova mensagem"), true);
  assert.deepEqual(command("ask-hermes").keywords?.includes("continuar conversa"), true);
  assert.deepEqual(command("run-task").keywords?.includes("nova tarefa"), true);
  assert.deepEqual(command("sessions").keywords?.includes("histórico"), true);
  assert.deepEqual(command("sessions").keywords?.includes("histórico de conversas"), true);
  assert.deepEqual(command("paste-answer").keywords?.includes("reutilizar resposta"), true);
  assert.deepEqual(command("paste-answer").keywords?.includes("copiar última resposta"), true);
});

test("Actions oferece um caminho explícito para o comando real de modelos", () => {
  assert.match(commonSource, /title="Escolher modelo"/);
  assert.match(commonSource, /name:\s*["']models["']/);
});

test("aprovação explica que as escolhas ficam em Actions e não inventa botões", () => {
  assert.match(approvalActionHint(), /Actions \(Ctrl\+K\)/);
  assert.match(approvalDetailsLostHint(), /detalhes.*perderam/i);
  assert.match(approvalDetailsLostHint(), /Negar/i);
});

test("aprovação sem detalhes mantém somente a saída segura e filtra choices próprias", () => {
  assert.doesNotMatch(approvalSource, /Aprovar mesmo sem ver os detalhes/);
  assert.match(approvalSource, /Object\.hasOwn\(CHOICE_SPECS, c\)/);
});
