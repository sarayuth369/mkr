export interface Env {
  ASSETS: Fetcher;
  LOGIN_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;
  /** Durable Objects (SQLite-backed). Optional so unit tests / a half-configured deploy degrade explicitly instead of crashing. */
  AUTH_STORE?: DurableObjectNamespace;
  FX_STORE?: DurableObjectNamespace;
  /** Secrets - set with `wrangler secret put`, never in source/Git. */
  MINVEST_PASSWORD?: string;
  MINVEST_SESSION_SECRET?: string;
  MINVEST_SCRIPT_URL?: string;
  MINVEST_SCRIPT_SECRET?: string;
  /** Optional recovery switch: changing this value makes the secret MINVEST_PASSWORD valid again and supersedes the stored hash. */
  MINVEST_PASSWORD_EPOCH?: string;
  SESSION_TTL_SECONDS?: string;
  /** Local-testing only (.dev.vars). Never set on the deployed Worker. */
  MINVEST_ALLOW_LOCAL_SCRIPT?: string;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
