// A hand-rolled chainable fake of the subset of the supabase-js query builder the route
// handlers and SSR pages use. Unlike a mock that "always succeeds", a test can script the
// exact `{ data, error }` a query resolves to — including a populated `error`, which is the
// whole point for the Risk #7 error-vs-absent assertions (test-plan §2 anti-pattern:
// "mocking Supabase so it can only ever succeed").
//
// Covers both `createClient` (RLS/cookie client) and `createAdminClient` (service-role) —
// they expose the same query-builder surface.
//
// Usage:
//   const stub = makeSupabaseStub({
//     "fitting_sessions.select": { data: { id: "s1", status: "processing" } },
//     "fitting_sessions.update": { data: null, error: null },
//   });
//   vi.mocked(createClient).mockReturnValue(stub as unknown as SupabaseClient);
//   // ...run the handler...
//   expect(stub.calls.map((c) => c.operation)).toEqual(["select", "update"]);

export type SupabaseOperation = "select" | "insert" | "update" | "delete" | "rpc";

/** What a scripted query resolves to. Both fields optional — omitted means `null`. */
export interface ScriptEntry {
  data?: unknown;
  error?: { message: string; code?: string; details?: string; hint?: string } | null;
}

export interface RecordedFilter {
  column: string;
  value: unknown;
}

export interface RecordedCall {
  table: string;
  operation: SupabaseOperation;
  /** How the chain was awaited — a terminal `.single()`/`.maybeSingle()` or a bare `await`. */
  terminal: "single" | "maybeSingle" | "await";
  filters: RecordedFilter[];
  /** The argument passed to `.insert()` / `.update()`, if any. */
  payload: unknown;
}

/**
 * Script keyed by `"<table>.<operation>"`, e.g. `"fitting_sessions.select"`. An RPC call is
 * scripted the same way under `"rpc.<name>"`, e.g. `"rpc.check_and_increment_rate_limit"`.
 */
export type SupabaseStubScript = Record<string, ScriptEntry>;

export interface SupabaseStub {
  from(table: string): SupabaseQueryBuilder;
  /** Scripted via `"rpc.<name>"`. Recorded into `calls` with `operation: "rpc"`, `table: name`. */
  rpc(name: string, args?: unknown): PromiseLike<{ data: unknown; error: ScriptEntry["error"] }>;
  /** Every terminal query, in call order. Assert ordering / filters / no-write here. */
  calls: RecordedCall[];
}

const resolved = (entry: ScriptEntry | undefined): { data: unknown; error: ScriptEntry["error"] } => ({
  data: entry?.data ?? null,
  error: entry?.error ?? null,
});

class SupabaseQueryBuilder implements PromiseLike<{ data: unknown; error: ScriptEntry["error"] }> {
  #table: string;
  #calls: RecordedCall[];
  #script: Map<string, ScriptEntry>;
  #operation: SupabaseOperation | null = null;
  #filters: RecordedFilter[] = [];
  #payload: unknown = undefined;

  constructor(table: string, calls: RecordedCall[], script: Map<string, ScriptEntry>) {
    this.#table = table;
    this.#calls = calls;
    this.#script = script;
  }

  #record(terminal: RecordedCall["terminal"]) {
    const operation = this.#operation ?? "select";
    this.#calls.push({
      table: this.#table,
      operation,
      terminal,
      filters: [...this.#filters],
      payload: this.#payload,
    });
    return resolved(this.#script.get(`${this.#table}.${operation}`));
  }

  select(_columns?: string): this {
    this.#operation ??= "select";
    return this;
  }

  insert(payload: unknown): this {
    this.#operation ??= "insert";
    this.#payload = payload;
    return this;
  }

  update(payload: unknown): this {
    this.#operation ??= "update";
    this.#payload = payload;
    return this;
  }

  delete(): this {
    this.#operation ??= "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filters.push({ column, value });
    return this;
  }

  order(_column: string, _options?: { ascending?: boolean }): this {
    return this;
  }

  single(): Promise<{ data: unknown; error: ScriptEntry["error"] }> {
    return Promise.resolve(this.#record("single"));
  }

  maybeSingle(): Promise<{ data: unknown; error: ScriptEntry["error"] }> {
    return Promise.resolve(this.#record("maybeSingle"));
  }

  then<TResult1 = { data: unknown; error: ScriptEntry["error"] }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: ScriptEntry["error"] }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#record("await")).then(onfulfilled, onrejected);
  }
}

export function makeSupabaseStub(script: SupabaseStubScript = {}): SupabaseStub {
  const scriptMap = new Map(Object.entries(script));
  const calls: RecordedCall[] = [];
  return {
    calls,
    from(table: string) {
      return new SupabaseQueryBuilder(table, calls, scriptMap);
    },
    rpc(name: string, args?: unknown) {
      calls.push({ table: name, operation: "rpc", terminal: "await", filters: [], payload: args });
      return Promise.resolve(resolved(scriptMap.get(`rpc.${name}`)));
    },
  };
}

export type { SupabaseQueryBuilder };
