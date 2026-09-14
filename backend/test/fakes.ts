import { RateLimiterRoom } from '../src/ratelimit-do';

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

/** Minimal fake DurableObjectNamespace for RateLimiterRoom - shards by
 * `idFromName(key)` exactly like the real namespace, backing each shard
 * with a real `RateLimiterRoom` instance so behavior (window rollover,
 * per-key isolation) matches production, not a re-implementation of it. */
export function createFakeRateLimiterNamespace(): DurableObjectNamespace {
  const rooms = new Map<string, { fetch(input: string, init?: RequestInit): Promise<Response> }>();
  return {
    idFromName(name: string) {
      return { toString: () => name } as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = id.toString();
      let room = rooms.get(key);
      if (!room) {
        const instance = new RateLimiterRoom();
        room = { fetch: (input: string, init?: RequestInit) => instance.fetch(new Request(input, init)) };
        rooms.set(key, room);
      }
      return room as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
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
