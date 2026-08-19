/**
 * Testes de `hermes-api.ts` — as invariantes de TRANSPORTE, que são as que quebram tudo
 * de uma vez quando saem do lugar:
 *
 *   1. `Authorization: Bearer <chave>` precisa carregar a CHAVE, não uma Promise.
 *      `requireApiKey()` é assíncrona; um `await` esquecido produzia
 *      `Bearer [object Promise]` e todo pedido autenticado voltava 401. O TypeScript
 *      não pega isso porque interpolar uma Promise num template literal é legal.
 *   2. NENHUMA requisição pode enviar `Origin` — o middleware de CORS responde 403 com
 *      corpo vazio antes mesmo de autenticar.
 *   3. `anonymous` (só `/health`) não pode mandar `Authorization`.
 *
 * O `fetch` global é substituído: nada aqui toca a rede. A descoberta de endpoint também
 * passa por `fetch` (a sonda `/health`), então o mesmo duplo cobre as duas coisas.
 *
 * Executar: `node --test tests/hermes-api.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import "./helpers/module-hooks.mjs";
import { __resetRaycastState, __setPreferences } from "./helpers/raycast-api-stub.mjs";

const { requestJson } = await import("../src/lib/hermes-api.ts");
const { invalidateBaseUrl } = await import("../src/lib/discovery.ts");

const BASE_URL = "http://127.0.0.1:8642";
/** Valor sentinela: não é uma chave real. */
const FIXTURE_KEY = "NAO_E_UMA_CHAVE_REAL_apenas_fixture";

interface CapturedRequest {
  url: string;
  headers: Headers;
}

const captured: CapturedRequest[] = [];
const realFetch = globalThis.fetch;

/**
 * Duplo do `fetch`: responde `/health` como o api_server e qualquer outra rota com um
 * JSON vazio. Registra toda requisição para as asserções sobre headers.
 */
function installFetchDouble(): void {
  captured.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, headers: new Headers(init?.headers) });

    const body = url.endsWith("/health")
      ? JSON.stringify({ status: "ok", platform: "hermes-agent", version: "0.20.4" })
      : JSON.stringify({ ok: true });

    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
}

async function setup(preferences: Record<string, unknown> = {}): Promise<void> {
  __resetRaycastState();
  __setPreferences({ apiServerKey: FIXTURE_KEY, apiUrl: BASE_URL, ...preferences });
  installFetchDouble();
  // O endpoint é memoizado no módulo: sem isto um teste herdaria a resolução do anterior.
  await invalidateBaseUrl();
}

test.after(() => {
  globalThis.fetch = realFetch;
});

/** A requisição de negócio é a última; as anteriores são sondas `/health` da descoberta. */
function lastRequest(): CapturedRequest {
  const request = captured.at(-1);
  assert.ok(request, "nenhuma requisição foi capturada");
  return request;
}

test("Authorization carrega a chave resolvida, nunca uma Promise", async () => {
  await setup();
  await requestJson({ path: "/v1/capabilities" });

  const authorization = lastRequest().headers.get("Authorization");
  assert.equal(authorization, `Bearer ${FIXTURE_KEY}`);
});

test("nenhum header de Authorization contém o rastro de uma Promise não aguardada", async () => {
  await setup();
  await requestJson({ path: "/v1/capabilities" });

  for (const request of captured) {
    const authorization = request.headers.get("Authorization") ?? "";
    assert.ok(!authorization.includes("Promise"), `header vazou uma Promise: ${authorization}`);
    assert.ok(!authorization.includes("object"), `header vazou um objeto: ${authorization}`);
  }
});

test("a chave detectada no LocalStorage também chega ao header (o caminho assíncrono)", async () => {
  await setup({ apiServerKey: undefined });
  const { saveDetectedApiKey } = await import("../src/lib/storage.ts");
  await saveDetectedApiKey(FIXTURE_KEY);

  await requestJson({ path: "/v1/capabilities" });
  assert.equal(lastRequest().headers.get("Authorization"), `Bearer ${FIXTURE_KEY}`);
});

test("NENHUMA requisição envia Origin — o CORS responde 403 antes de autenticar", async () => {
  await setup();
  await requestJson({ path: "/v1/capabilities" });

  assert.ok(captured.length > 0, "esperava ao menos a sonda /health e o pedido");
  for (const request of captured) {
    assert.equal(request.headers.get("Origin"), null, `${request.url} enviou Origin`);
  }
});

test("requisição anônima (/health) não manda Authorization", async () => {
  await setup();
  await requestJson({ path: "/health", anonymous: true });

  assert.equal(lastRequest().headers.get("Authorization"), null);
});

test("X-Hermes-Session-Key só vai quando a rota pede, e sem caracteres proibidos", async () => {
  await setup({ sessionKey: "raycast:windows:default" });

  await requestJson({ path: "/v1/capabilities" });
  assert.equal(lastRequest().headers.get("X-Hermes-Session-Key"), null);

  await requestJson({ method: "POST", path: "/v1/runs", body: { input: "oi" }, withSessionKey: true });
  assert.equal(lastRequest().headers.get("X-Hermes-Session-Key"), "raycast:windows:default");
});

test("sem chave nenhuma, o pedido falha ANTES de tocar a rede", async () => {
  await setup({ apiServerKey: undefined });

  await assert.rejects(
    () => requestJson({ path: "/v1/capabilities" }),
    (err: unknown) => {
      assert.equal((err as Error).name, "HermesNotConfiguredError");
      return true;
    },
  );
  assert.equal(captured.length, 0, "não pode haver requisição sem chave resolvida");
});
