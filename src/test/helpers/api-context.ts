import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";

// Builds the minimal `APIContext` our route handlers actually read: `locals.user`,
// `request` (headers + JSON body), `params`, `cookies`. The handlers never touch the rest
// of the real context, so a hand-built object cast at the call site is lighter than booting
// the worker.
//
//   const context = makeApiContext({ user: { id: "u1" } as User, params: { id: "s1" } });
//   const res = await GET(context);

export interface MakeApiContextOptions {
  /** `context.locals.user`. Omit / `null` for an unauthenticated request. */
  user?: User | null;
  /** Route params, e.g. `{ id: "session-uuid" }`. */
  params?: Record<string, string | undefined>;
  /** JSON body — serialised onto the `Request` with a JSON content-type unless one is set. */
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Seed cookie values, keyed by name. */
  cookies?: Record<string, string>;
  /** Defaults to `GET` when there is no body, `POST` when there is. */
  method?: string;
  /** Request URL — only matters if a handler reads `context.url`. */
  url?: string;
}

interface CookieValue {
  value: string;
  json: () => unknown;
}

function makeCookieStub(seed: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get(key: string): CookieValue | undefined {
      const value = store.get(key);
      if (value === undefined) return undefined;
      return { value, json: () => JSON.parse(value) as unknown };
    },
    set(key: string, value: string): void {
      store.set(key, value);
    },
    delete(key: string): void {
      store.delete(key);
    },
    has(key: string): boolean {
      return store.has(key);
    },
  };
}

export function makeApiContext(options: MakeApiContextOptions = {}): APIContext {
  const { user = null, params = {}, body, headers = {}, cookies = {}, url = "http://test.local/api" } = options;
  const method = options.method ?? (body === undefined ? "GET" : "POST");

  const requestHeaders = new Headers(headers);
  const init: RequestInit = { method, headers: requestHeaders };
  if (body !== undefined) {
    if (!requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const request = new Request(url, init);

  return {
    locals: { user },
    params,
    request,
    cookies: makeCookieStub(cookies),
    url: new URL(url),
  } as unknown as APIContext;
}
