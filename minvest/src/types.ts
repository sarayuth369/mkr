export interface Env {
  ASSETS: Fetcher;
  LOGIN_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;
  /** Secrets - set with `wrangler secret put`, never in source/Git. */
  MINVEST_PASSWORD?: string;
  MINVEST_SESSION_SECRET?: string;
  MINVEST_SCRIPT_URL?: string;
  MINVEST_SCRIPT_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
  /** Local-testing only (.dev.vars). Never set on the deployed Worker. */
  MINVEST_ALLOW_LOCAL_SCRIPT?: string;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
