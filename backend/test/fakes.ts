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
