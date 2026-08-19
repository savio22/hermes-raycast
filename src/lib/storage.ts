/**
 * Armazenamento local da extensão (docs/ARCHITECTURE.md §9).
 *
 * Divisão de responsabilidades:
 *   LocalStorage — banco criptografado do Raycast, durável e assíncrono. Guarda o que
 *                  o servidor NÃO sabe devolver: o índice de execuções (não existe
 *                  `GET /v1/runs`), as aprovações recebidas pelo stream (não existe rota
 *                  que liste aprovações pendentes), a chave detectada e o endpoint resolvido.
 *   Cache        — arquivo simples em disco, síncrono, LRU. Só dados públicos e
 *                  descartáveis, sempre com TTL: capabilities, modelos, skills, toolsets.
 *
 * O QUE NUNCA É GUARDADO, EM LUGAR NENHUM:
 *   - transcrições completas (`GET /api/sessions/{id}/messages`);
 *   - conteúdo de mensagens, previews longos, argumentos de ferramentas;
 *   - a `API_SERVER_KEY` no `Cache` (só no LocalStorage, e só quando detectada).
 * A única exceção deliberada é o resultado final de uma execução que o próprio usuário
 * disparou no Raycast, truncado, porque o servidor descarta o status terminal em 1 h.
 */

import { Cache, LocalStorage } from "@raycast/api";

export const StorageKeys = {
  /** {baseUrl, version, source, gatewayPid, gatewayStartTime, checkedAt} — 12 h + pid. */
  endpointCache: "hermes.endpoint.v1",
  /**
   * Chave detectada pela ação explícita "Detectar configuração automaticamente".
   * A preferência `apiServerKey` sempre vence sobre este valor (UX-SPEC §3.3).
   */
  detectedApiKey: "hermes.detectedKey.v1",
  lastSessionId: "hermes.lastSessionId.v1",
  /** {provider?, model?} — ação "Usar como modelo padrão". Vence a preferência. */
  defaultModel: "hermes.defaultModel.v1",
  /** {provider?, model?} — ação "Usar só na próxima pergunta". Apagar após consumir. */
  nextTurnModel: "hermes.nextTurnModel.v1",
  runIndex: "hermes.runs.v1",
  approvalPrefix: "hermes.approval.v1.",
  runResultPrefix: "hermes.runResult.v1.",
} as const;

/* ───────────────── LocalStorage (durável, assíncrono) ───────────────── */

export async function readJson<TValue>(key: string): Promise<TValue | undefined> {
  const raw = await LocalStorage.getItem<string>(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as TValue;
  } catch {
    await LocalStorage.removeItem(key);
    return undefined;
  }
}

export async function writeJson<TValue>(key: string, value: TValue | undefined): Promise<void> {
  if (value === undefined) {
    await LocalStorage.removeItem(key);
    return;
  }
  await LocalStorage.setItem(key, JSON.stringify(value));
}

/* ───────────────────────── Chave detectada ─────────────────────────── */

/**
 * SEGURANÇA: as três funções abaixo são o único lugar da extensão que persiste a
 * `API_SERVER_KEY`. O valor vai para o LocalStorage (criptografado) e nunca para o
 * `Cache`, para arquivo, para log, para toast, para erro ou para o clipboard.
 * Gravar só a partir da ação explícita do usuário (UX-SPEC §3.1) — nunca em background.
 */
export async function saveDetectedApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === "") return;
  await LocalStorage.setItem(StorageKeys.detectedApiKey, trimmed);
}

export async function readDetectedApiKey(): Promise<string | undefined> {
  const stored = await LocalStorage.getItem<string>(StorageKeys.detectedApiKey);
  if (typeof stored !== "string" || stored.trim() === "") return undefined;
  return stored.trim();
}

/** Ação "Esquecer a chave detectada" e resposta automática a 401 `gateway_auth_failed`. */
export function forgetDetectedApiKey(): Promise<void> {
  return LocalStorage.removeItem(StorageKeys.detectedApiKey);
}

/* ───────────────────── Cache (síncrono, LRU 10 MB) ──────────────────── */

const cache = new Cache({ namespace: "hermes" });

interface CacheEnvelope<TValue> {
  v: 1;
  at: number;
  data: TValue;
}

export function cacheRead<TValue>(key: string, maxAgeMs: number): TValue | undefined {
  const raw = cache.get(key);
  if (!raw) return undefined;
  try {
    const envelope = JSON.parse(raw) as CacheEnvelope<TValue>;
    if (envelope.v !== 1 || Date.now() - envelope.at > maxAgeMs) return undefined;
    return envelope.data;
  } catch {
    cache.remove(key);
    return undefined;
  }
}

export function cacheWrite<TValue>(key: string, data: TValue): void {
  cache.set(key, JSON.stringify({ v: 1, at: Date.now(), data } satisfies CacheEnvelope<TValue>));
}

export const CacheKeys = {
  capabilities: "capabilities",
  modelOptions: "modelOptions",
  skills: "skills",
  toolsets: "toolsets",
  sessionsFirstPage: "sessionsFirstPage",
} as const;

export const CacheTtl = {
  capabilities: 5 * 60_000,
  modelOptions: 10 * 60_000,
  skills: 5 * 60_000,
  /** Endpoint lento (27+ toolsets resolvidos no event loop do servidor). */
  toolsets: 15 * 60_000,
  /** Só para pintura instantânea da lista; sempre revalidar depois. */
  sessionsFirstPage: 30_000,
} as const;

/** Cache-primeiro simples: devolve o valor fresco do disco ou busca e grava. */
export async function cachedFetch<TValue>(key: string, ttlMs: number, loader: () => Promise<TValue>): Promise<TValue> {
  const hit = cacheRead<TValue>(key, ttlMs);
  if (hit !== undefined) return hit;
  const fresh = await loader();
  cacheWrite(key, fresh);
  return fresh;
}

/* ─────────────────────── Índice de execuções ────────────────────────── */

/**
 * Não existe `GET /v1/runs`: quem não guardar o `run_id` perde a execução para sempre.
 * Por isso este índice é gravado ANTES de renderizar qualquer coisa após o 202.
 */
export interface StoredRun {
  runId: string;
  sessionId?: string;
  /** Prompt truncado em 200 chars, só para identificar o item na lista. */
  promptPreview: string;
  createdAt: number;
  lastKnownStatus: string;
  lastKnownEvent?: string;
  baseUrl: string;
}

const MAX_STORED_RUNS = 20;
const RUN_INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function listStoredRuns(): Promise<StoredRun[]> {
  const runs = (await readJson<StoredRun[]>(StorageKeys.runIndex)) ?? [];
  const cutoff = Date.now() - RUN_INDEX_MAX_AGE_MS;
  return runs.filter((run) => run.createdAt >= cutoff);
}

export async function rememberRun(run: StoredRun): Promise<void> {
  const runs = await listStoredRuns();
  const next = [run, ...runs.filter((r) => r.runId !== run.runId)].slice(0, MAX_STORED_RUNS);
  await writeJson(StorageKeys.runIndex, next);
}

export async function updateStoredRun(runId: string, patch: Partial<StoredRun>): Promise<void> {
  const runs = await listStoredRuns();
  await writeJson(
    StorageKeys.runIndex,
    runs.map((run) => (run.runId === runId ? { ...run, ...patch } : run)),
  );
}

export async function forgetRun(runId: string): Promise<void> {
  const runs = await listStoredRuns();
  await writeJson(
    StorageKeys.runIndex,
    runs.filter((run) => run.runId !== runId),
  );
  await LocalStorage.removeItem(StorageKeys.approvalPrefix + runId);
  await LocalStorage.removeItem(StorageKeys.runResultPrefix + runId);
}

/* ──────────────────── Aprovações e resultados de run ────────────────── */

/**
 * Não existe endpoint que liste aprovações pendentes: todo `approval.request` recebido
 * pelo stream precisa ser gravado na hora, ou o usuário aprovaria às cegas.
 */
export interface StoredApproval {
  runId: string;
  command?: string;
  description?: string;
  /** Renderizar exatamente o array recebido; as opções variam por pedido. */
  choices: string[];
  requestId?: string;
  receivedAt: number;
}

export function saveApprovalRequest(approval: StoredApproval): Promise<void> {
  return writeJson(StorageKeys.approvalPrefix + approval.runId, approval);
}

export function loadApprovalRequest(runId: string): Promise<StoredApproval | undefined> {
  return readJson<StoredApproval>(StorageKeys.approvalPrefix + runId);
}

export function clearApprovalRequest(runId: string): Promise<void> {
  return LocalStorage.removeItem(StorageKeys.approvalPrefix + runId);
}

export interface StoredRunResult {
  runId: string;
  status: string;
  /** Truncado em 4000 chars na gravação. */
  output?: string;
  error?: string;
  savedAt: number;
}

export function saveRunResult(result: StoredRunResult): Promise<void> {
  return writeJson(StorageKeys.runResultPrefix + result.runId, {
    ...result,
    output: result.output?.slice(0, 4000),
    error: result.error?.slice(0, 2000),
  });
}

export function loadRunResult(runId: string): Promise<StoredRunResult | undefined> {
  return readJson<StoredRunResult>(StorageKeys.runResultPrefix + runId);
}

/* ─────────────────────────── Manutenção ─────────────────────────────── */

const APPROVAL_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Poda aprovações e resultados vencidos. Barato: um `allItems` e alguns `removeItem`. */
export async function pruneLocalData(): Promise<void> {
  const all = await LocalStorage.allItems<Record<string, string>>();
  const now = Date.now();
  for (const [key, raw] of Object.entries(all)) {
    const isApproval = key.startsWith(StorageKeys.approvalPrefix);
    const isResult = key.startsWith(StorageKeys.runResultPrefix);
    if (!isApproval && !isResult) continue;
    try {
      const parsed = JSON.parse(raw) as { receivedAt?: number; savedAt?: number };
      const stamp = parsed.receivedAt ?? parsed.savedAt ?? 0;
      const maxAge = isApproval ? APPROVAL_MAX_AGE_MS : RESULT_MAX_AGE_MS;
      if (now - stamp > maxAge) await LocalStorage.removeItem(key);
    } catch {
      await LocalStorage.removeItem(key);
    }
  }
}

/** Ação "Limpar dados locais". Apaga a chave detectada também. Não toca em nada no Hermes. */
export async function clearAllLocalData(): Promise<void> {
  await LocalStorage.clear();
  cache.clear();
}
