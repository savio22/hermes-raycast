import test from "node:test";
import assert from "node:assert/strict";

import "./helpers/module-hooks.mjs";

const { mapHttpError } = await import("../src/lib/errors.ts");

const forbidden = /\b(histórico|API|endpoint|token|SSE|JSON|stream|run|session|chat|thread)\b/i;

test("copy nova de autorização e entrada usa o vocabulário de produto", () => {
  const messages = [
    mapHttpError({
      method: "GET",
      path: "/api/jobs",
      status: 401,
      body: '{"error":{"code":"gateway_auth_failed"}}',
    }).userMessage,
    mapHttpError({ method: "GET", path: "/api/sessions/s1/messages", status: 400, body: "invalid_pagination" })
      .userMessage,
    "Configurar no Hermes Desktop",
    "O texto é muito longo: preservei o começo e o fim e removi só o meio.",
    "O modelo escolhido não está autenticado no Hermes. Abra o Hermes Desktop e configure o provedor, ou escolha outro modelo.",
  ];
  for (const message of messages) assert.doesNotMatch(message, forbidden, message);
});
