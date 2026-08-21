/**
 * Duplo em memória de `@raycast/api` para os testes.
 *
 * Por que existe: o pacote `@raycast/api` instalado é SÓ tipos (`"types": "types/index.d.ts"`,
 * sem `main`). O runtime é injetado pelo host do Raycast na hora do `ray build`, então
 * qualquer módulo que o importe — `preferences.ts` e `storage.ts` — é impossível de carregar
 * sob `node --test` sem um substituto. `module-hooks.mjs` redireciona o especificador para
 * este arquivo.
 *
 * Implementa apenas a superfície que `src/lib/` usa: `getPreferenceValues`, `LocalStorage`
 * e `Cache`. Se um módulo novo precisar de mais, acrescente aqui.
 */

let preferences = {};
const localStorageStore = new Map();
const cacheStore = new Map();
let storageHooks = {};

/* ─────────────────────── Controles usados pelos testes ─────────────────────── */

export function __setPreferences(next) {
  preferences = { ...next };
}

export function __resetRaycastState() {
  preferences = {};
  localStorageStore.clear();
  cacheStore.clear();
  storageHooks = {};
}

export function __setLocalStorageHooks(next) {
  storageHooks = { ...next };
}

export function __localStorageSnapshot() {
  return Object.fromEntries(localStorageStore);
}

/* ────────────────────────── Superfície de @raycast/api ─────────────────────── */

export function getPreferenceValues() {
  return { ...preferences };
}

export const LocalStorage = {
  async getItem(key) {
    if (storageHooks.getItem) await storageHooks.getItem(key);
    return localStorageStore.has(key) ? localStorageStore.get(key) : undefined;
  },
  async setItem(key, value) {
    if (storageHooks.setItem) await storageHooks.setItem(key, value);
    localStorageStore.set(key, String(value));
  },
  async removeItem(key) {
    if (storageHooks.removeItem) await storageHooks.removeItem(key);
    localStorageStore.delete(key);
  },
  async allItems() {
    return Object.fromEntries(localStorageStore);
  },
  async clear() {
    localStorageStore.clear();
  },
};

export class Cache {
  constructor(options = {}) {
    this.namespace = options.namespace ?? "";
  }

  #scoped(key) {
    return `${this.namespace}:${key}`;
  }

  get(key) {
    return cacheStore.get(this.#scoped(key));
  }

  set(key, value) {
    cacheStore.set(this.#scoped(key), String(value));
  }

  remove(key) {
    return cacheStore.delete(this.#scoped(key));
  }

  clear() {
    cacheStore.clear();
  }
}
