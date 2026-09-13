/** Minimal D1Database stand-in that just records every bound statement -
 * enough to assert what an audit-log write contained without a real D1
 * binding (or touching any real data). */
export interface RecordedD1Call {
  sql: string;
  args: unknown[];
}

export function createFakeD1(): { db: D1Database; calls: RecordedD1Call[] } {
  const calls: RecordedD1Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async run() {
              return { success: true, meta: {} } as unknown;
            },
            async first() {
              return null;
            },
            async all() {
              return { results: [], success: true, meta: {} } as unknown;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

/** Minimal in-memory KVNamespace stand-in - just enough of the surface these tests touch. */
export function createFakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: unknown) {
      const value = store.get(key);
      if (value === undefined) return null;
      if (type === 'json') return JSON.parse(value);
      return value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null } as never;
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null } as never;
    },
  } as unknown as KVNamespace;
}
