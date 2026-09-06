---
title: "Invariant & Aggregate Refactor — the FittingSession lifecycle"
created: 2026-09-06
type: refactor-plan
---

# Invariant & Aggregate Refactor — the FittingSession lifecycle

> Product of a DDD pass focused on **discovering, choosing, and hardening one
> domain invariant**. This is a refactor _plan_ — no production code is changed
> by this document. Discovery → identification → classification → diagnosis →
> design.

---

## Step 0 — Context discovered

**Product.** BikeFit (`README.md`, `context/foundation/prd.md`). A logged-in
cyclist uploads a ≤10–15 s side-view clip; the **browser** runs pose estimation

- a vision LLM to find BDC/TDC keyframes, measures joint angles, and a second
  LLM turns the angles into plain-language fit advice. Every attempt is saved to
  session history.

**Stack / layers where business logic lives.**

| Layer            | Where                                                                               | What lives here today                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence      | `supabase/migrations/*.sql`                                                         | `fitting_sessions`, `analysis_results`, `rate_limits`; RLS; one enum `CHECK`; `updated_at` trigger; one atomic RPC (`check_and_increment_rate_limit`)                                           |
| Service / domain | `src/lib/services/`, `src/lib/`                                                     | LLM boundary (`llm.ts`), rate-limit port (`rate-limit.ts`), pure helpers (`pose/angles.ts`, `angle-verdict.ts`, `session-display-status.ts`) — **no domain model, no aggregate, no repository** |
| API routes       | `src/pages/api/**`                                                                  | `sessions/index.ts` (create), `sessions/[id].ts` (GET/DELETE), `sessions/[id]/start.ts`, `sessions/[id]/recommend.ts`, `sessions/[id]/results.ts`, `analyze.ts`                                 |
| UI / client      | `src/pages/sessions/*.astro`, `src/components/VideoAnalyzer.tsx`, `VideoUpload.tsx` | SSR reads of session + results; the **entire analysis pipeline**, which also drives status transitions                                                                                          |

**Key requirement sources.**

- PRD §Success Criteria / §Guardrails: _"Every analysis attempt returns either a
  result or a clear, human-readable failure message — **no silent errors**."_
  (`prd.md:40`)
- PRD §Non-Functional: _"Analysis may take up to 5–10 minutes… the user is not
  expected to wait on-screen. The product must show processing status … and
  surface the completed result when the user returns."_ (`prd.md:97`)
- PRD §Business Logic: the fit is _"explicitly iterative: each submission is one
  round"_ — session history is the record of that progression (`prd.md:105`).
- Roadmap North Star **S-02**: _"the user's uploaded video is fully processed and
  fitting recommendations are ready to view"_ (`roadmap.md` §North star).
- PRD §NFR privacy: _"Video data leaves no trace in operator-accessible storage
  after the analysis request that consumed it completes."_ (`prd.md:95`)
- Test-plan Risk **#6** (stuck `processing`) and **#7** (query error rendered as
  absent data) — `context/foundation/test-plan.md:54-55`.

---

## Step 1 — Business invariants identified

Rules that **must always be true** in this domain, pulled from documents _and_
code.

| ID         | Invariant (must always hold)                                                                                                                                                         | Source (doc + code)                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **INV‑1**  | A fitting session follows exactly one monotonic lifecycle `queued → processing → {completed \| failed}`; transitions are legal-source-state-only; `completed`/`failed` are terminal. | `20260526120000_initial_schema.sql:18-19` (enum `CHECK`); async-job-pipeline plan (`context/archive/2026-05-31-async-job-pipeline/plan.md` "Desired End State"); `start.ts:34`, `results.ts:48`, `recommend.ts:47`, `analyze.ts:70` all gate on a specific source status |
| **INV‑2**  | A session is `completed` **iff** exactly one `analysis_results` row exists for it, and both facts become true together (no partial write).                                           | PRD US‑01 acceptance (`prd.md:50-53`); `sessions/[id].astro:44-58` ("_A `completed` session should always have a results row_"); `results.ts:59-76` writes the two facts as two statements                                                                               |
| **INV‑3**  | Every analysis attempt reaches a **terminal, human-readable** state — no session is stuck in `processing`/`queued` forever, and no failure is silent.                                | PRD §Guardrails (`prd.md:40`); test-plan Risk #6 (`test-plan.md:54`); `session-display-status.ts` exists solely to paper over this                                                                                                                                       |
| **INV‑4**  | `status` and results are written **only by the server** (`service_role`); the browser is an untrusted client that _requests_ outcomes.                                               | `20260526120000_initial_schema.sql:44-46,75-76` ("_No UPDATE… policy… performed by… service_role_"); contradicted by `VideoAnalyzer.tsx:99-112,120-121`                                                                                                                  |
| **INV‑5**  | A session and its results are private to the owning user, for **reads and writes**.                                                                                                  | PRD §Access Control (`prd.md:109-111`); test-plan Risk #5 (`test-plan.md:53`); enforced per-route via `.eq("user_id", …)` belt-and-braces (`start.ts:47`, `results.ts:76,92`, `[id].ts:79`)                                                                              |
| **INV‑6**  | Raw video is **never persisted** in operator-accessible storage — process and discard.                                                                                               | PRD §NFR privacy (`prd.md:95`), §Guardrails (`prd.md:38`); `db-schema-and-privacy-design/plan.md:190` ("_No column named `video`… exists_"); `video_r2_key` never written by any route                                                                                   |
| **INV‑7**  | A session's status transition is **atomic under concurrency** — no lost update, no double-apply, no two results rows.                                                                | Implied by INV‑1/INV‑2; `rate_limits` RPC (`20260905150000_add_rate_limits.sql`) is the codebase's own precedent for "do the check-and-write in one server-side statement"                                                                                               |
| **INV‑8**  | Angles are computed against the reference-frame definitions they are judged by (vertex, included-vs-flexion, torso-from-horizontal).                                                 | PRD §Success Criteria ±10° (`prd.md:31`); `reference-angles.md`; `pose/angles.ts` + `angle-verdict.ts`                                                                                                                                                                   |
| **INV‑9**  | Recommendations are generated only against the five authoritative gravel bands; the band number lives in exactly one place.                                                          | PRD OQ‑2 RESOLVED (`prd.md:128`); `reference-angles.md:15-24`; `ANGLE_REFS` in `pose/angles.ts`, pinned by `pose/angles.test.ts`                                                                                                                                         |
| **INV‑10** | Session duration is within the accepted clip-length window before an analysis is created.                                                                                            | PRD FR‑003 (`prd.md:67`); `VideoUpload.tsx:25-26,73-80` (client); `schemas.ts:5` (`z.number().positive()` only — server)                                                                                                                                                 |

INV‑1, ‑2, ‑3, ‑4, ‑7 are **facets of one thing**: the integrity of the
`FittingSession` lifecycle. That is the object of this refactor.

---

## Step 2 — Classification and the #1 pick

Each invariant scored on: **(a)** how core to the product's meaning,
**(b)** how smeared across layers, **(c)** how genuinely enforced.

| ID                       | (a) Core?                                                                       | (b) Smeared across…                                           | (c) Enforced?                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INV‑1 lifecycle**      | **Highest** — it _is_ the North Star outcome + the "no silent errors" guardrail | **~13 sites, 4 layers** (see Step 3)                          | **Weak** — read-then-write guards, non-atomic, no terminal-state guarantee in storage                                                                                 |
| INV‑2 completed⇔results  | High                                                                            | 3 sites (`results.ts`, `[id].astro`, migration)               | **Weak** — two separate statements; no `UNIQUE(session_id)`                                                                                                           |
| INV‑3 terminal state     | High                                                                            | `results.ts`, `session-display-status.ts`, both session pages | **Illusory** — reconciled at _render time only_; the row stays `processing` forever (`session-display-status.ts:13-14`)                                               |
| INV‑4 server-only writes | High                                                                            | migration comments vs. `VideoAnalyzer.tsx`                    | **Violated by design** — client POSTs the `failed` transition with a client-authored message                                                                          |
| INV‑5 ownership          | High                                                                            | every session route + both pages                              | **Medium** — a dedicated pass (`testing-llm-and-ownership`) added the pre-check + `.eq("user_id")` everywhere; verbose but real; RLS UPDATE policy still absent/inert |
| INV‑6 no raw video       | High                                                                            | schema + routes (by absence)                                  | **Strong (structural)** — there is no column to write; nothing to refactor                                                                                            |
| INV‑7 atomicity          | High                                                                            | none — it does not exist anywhere                             | **Absent**                                                                                                                                                            |
| INV‑8 angle geometry     | High                                                                            | `pose/angles.ts`, `VideoAnalyzer.tsx`                         | **Medium** — Phase 1 unit tests cover it; it is an accuracy target, not an aggregate-guardable rule                                                                   |
| INV‑9 reference bands    | High                                                                            | `pose/angles.ts` ⇢ prompt ⇢ verdict                           | **Strong** — single-source + a pinning test (`resolve-angle-reference-bands`)                                                                                         |
| INV‑10 duration window   | Medium                                                                          | `VideoUpload.tsx` (real), `schemas.ts` (weak)                 | **Client-only** — server accepts any positive number                                                                                                                  |

### Chosen invariant: **INV‑1 (with INV‑2/3/4/7 folded in) — the FittingSession lifecycle**

Stated precisely:

> **A `FittingSession` has exactly one lifecycle — `queued → processing →
{completed | failed}` — where:**
>
> 1. **every transition is a guarded compare-and-set**: applied only if the
>    aggregate is in the expected source state; an illegal source state
>    **refuses** the operation with a _named domain error_, never overwrites;
> 2. **`completed` and `failed` are terminal** — nothing transitions out of them;
> 3. a session is **`completed` if and only if** it carries **exactly one**
>    `AnalysisResult`, and that result plus the `completed` stamp are written in
>    **one transaction**;
> 4. a session that entered `processing` **always** reaches a terminal state _in
>    storage_ — "stuck forever" is not a representable end state; a timeout is a
>    real, persisted `failed` transition, not a display-time illusion;
> 5. **only the server writes `status`** — the browser pipeline _requests_
>    transitions and _reports_ a failure reason; it does not co-decide them.

**Why this one.** It is simultaneously **the most core** (S-02 — "video fully
processed, recommendations ready to view" — is literally a value of `status`; the
"no silent errors" guardrail is a statement about this lifecycle) **and the least
genuinely enforced**: there is no atomic transition anywhere in the system, the
"reaches a terminal state" guarantee is faked at render time, one transition
(`processing → failed`) explicitly swallows its own write failure and returns
`{ ok: true }`, and the browser is a co-author of the state machine. INV‑6 is
equally core but already airtight _by absence of a column_; INV‑8/‑9 are already
covered by tests and single-sourcing. INV‑1 is where core-ness and fragility
intersect.

---

## Step 3 — Diagnosis of INV‑1

### 3.1 Where the rule lives today (verified `file:line`)

| Fragment of the rule                         | Layer    | Location                                                                                                                                                                                                                                           | Enforcement verdict                                                                                                                                                        |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal status **values**                      | DB       | `20260526120000_initial_schema.sql:18-19` — `CHECK (status IN ('queued','processing','completed','failed'))`                                                                                                                                       | Enforces the _alphabet_, not the _grammar_. `completed → queued` passes the CHECK.                                                                                         |
| Initial state                                | API      | `sessions/index.ts:35` — `status: "queued"` on insert                                                                                                                                                                                              | OK                                                                                                                                                                         |
| `queued → processing`                        | API      | `start.ts:20-24` read, `:34-36` guard `!== "queued"` → 409, `:43-47` `UPDATE … SET status='processing' WHERE id=? AND user_id=?`                                                                                                                   | **TOCTOU** — the `UPDATE` has no `AND status='queued'`; the guard is a separate prior read.                                                                                |
| `queued → processing` write failure          | API      | `start.ts:52-55` — `updateError` → 500                                                                                                                                                                                                             | A **0-row match is not an `error`** in supabase-js (`session-display-status.ts:19-22` spells this out) → silently no-ops; client believes it is `processing`.              |
| `processing` precondition for pipeline steps | API      | `recommend.ts:47-49`, `analyze.ts:70-72` — guard `!== "processing"` → 409                                                                                                                                                                          | Read-only guards, no transition; each route re-reads status independently.                                                                                                 |
| `processing → completed` + results insert    | API      | `results.ts:59-64` insert `analysis_results`, then `:72-76` `UPDATE … status='completed'`                                                                                                                                                          | **Two statements, no transaction.** Comment `:78-82` documents the orphan (`analysis_results` row against a still-`processing` session) as _accepted_.                     |
| `processing → completed` write failure       | API      | `results.ts:83-86` — `updateError` → 500 (after the insert already committed)                                                                                                                                                                      | Half-applied transition is the _documented_ outcome.                                                                                                                       |
| `processing → failed`                        | API      | `results.ts:88-92` — `UPDATE … status='failed', error_message=?`                                                                                                                                                                                   | Source state not re-checked against `failed`; message is **client-authored** (see below).                                                                                  |
| `processing → failed` write failure          | API      | `results.ts:97-99` — `console.error(...)` then **falls through to `return Response.json({ ok: true })`** at `:102`                                                                                                                                 | **Fail-fast violation.** Pinned as intended by `_results.test.ts:120-130`.                                                                                                 |
| No `UNIQUE(session_id)` on results           | DB       | `20260526120000_initial_schema.sql:82` — `CREATE INDEX` (non-unique)                                                                                                                                                                               | Two `/results` successes → two rows → `[id].astro:45-49` `.maybeSingle()` **errors** → `resultsLoadError` → user permanently sees "Couldn't load your results."            |
| "Reaches a terminal state"                   | lib + UI | `session-display-status.ts:24-30` `effectiveSessionStatus()` maps stale `processing`/`queued` → `"failed"` **for rendering only** (`:13-14`, `:23`: "_The stored row is never written_")                                                           | The DB row stays `processing`/`queued` **forever**. Test-plan §7 (`:874-878`): a server-side reaper is _"deliberately not built."_ Any non-UI consumer sees a false state. |
| Terminal-state render                        | UI       | `sessions/[id].astro:39,129-147`; `sessions/index.astro:74-75`                                                                                                                                                                                     | Two independent call sites re-derive the "effective" status with `Date.now()`.                                                                                             |
| Client co-authors the machine                | client   | `VideoAnalyzer.tsx:120-121` — `if (!res.ok && res.status !== 409) throw` (the **client** decides a 409 means "carry on"); `:99-112` `postError()` has the **client** POST `{ error: true, error_message }` — a client-authored terminal transition | Enforcement of "_when does a fit fail, and with what message_" lives in the browser.                                                                                       |
| Client mirrors the lifecycle                 | client   | `VideoUpload.tsx:6-13` — `AppState` union (`creating`/`analyzing`/`completed`/`failed`)                                                                                                                                                            | A parallel state machine with its own transitions.                                                                                                                         |
| Poll endpoint                                | API      | `sessions/[id].ts:8-39` — `GET` returns `{ status, updated_at, error_message }`                                                                                                                                                                    | **No caller** — `grep` shows nothing fetches it; a fourth status-reading surface kept alive.                                                                               |

### 3.2 The four concrete failure modes

1. **Stuck `processing` in storage (INV‑3 broken).** Tab closes during the
   multi-minute client pipeline → no `/results` POST ever arrives → the row is
   `processing` forever. The UI _hides_ this via `effectiveSessionStatus`, but
   the persisted invariant is simply false. The iterative-fitting history
   (`prd.md:105`) and any future "compare two sessions" feature
   (FR‑010, `prd.md:90`) read a lie.

2. **Silent failure (INV‑3 + fail-fast broken).** `results.ts:97-99` — a failed
   `processing → failed` write is logged and the route reports success. The one
   place whose entire job is "record that this attempt failed" is allowed to not
   do its job without telling anyone.

3. **Half-completed session (INV‑2 broken).** `results.ts` inserts the result
   row, then flips status in a _second_ statement. A crash, a timeout, or a
   0-row ownership match between the two leaves `analysis_results` populated
   against a `processing` session — the exact orphan the code comment at
   `results.ts:78-82` accepts.

4. **Double results row (INV‑2 + INV‑7 broken).** No `UNIQUE(session_id)`; the
   `processing` guard is a non-atomic pre-read. Two `/results` calls that race
   both insert. `[id].astro`'s `.maybeSingle()` then errors permanently and the
   user can never see results for a session that _did_ complete.

### 3.3 Layers that do **not** enforce it

- **DB:** enforces enum membership only. No transition constraint, no
  `UNIQUE(session_id)`, no atomic transition function, no UPDATE RLS policy
  (writes bypass RLS entirely via `service_role`).
- **Service/domain:** there is no domain layer. No `FittingSession` object with
  behaviour — `src/types.ts:3-13` is an anemic DTO.
- **API routes:** each of the four pipeline routes re-reads status and hand-rolls
  its own guard string (`"Session is not in queued state"` /
  `"…processing state"`). The transition write is never conditional on the
  source state.
- **Client:** actively participates — decides what a 409 means, authors failure
  messages, owns the `queued → processing` retry semantics.

---

## Step 4 — Design: the guardian aggregate

### 4.1 Aggregate boundary

```
FittingSession               ← aggregate root (consistency boundary)
├─ id, ownerId               ← identity
├─ status: SessionStatus     ← value object (the state machine)
├─ video: VideoMetadata      ← value object (filename, durationSeconds) — NO raw bytes (INV‑6)
├─ failureReason: string?    ← set only on → failed
├─ result: AnalysisResult?   ← entity, INSIDE the boundary (0..1)
├─ createdAt, updatedAt
└─ (domain methods below)
```

- `AnalysisResult` is an **entity within the `FittingSession` boundary**, not its
  own aggregate: it has no identity or lifecycle outside the session, it is
  created exactly once at completion, and it is cascade-deleted with the session
  (`analysis_results.session_id … ON DELETE CASCADE`). It is never loaded on its
  own.
- One repository, one aggregate root, one transaction per `save`.

### 4.2 The state machine (single source of truth)

```
        queue()                beginProcessing()          completeWith(result)
  ∅ ───────────────▶ queued ───────────────────▶ processing ──────────────────▶ completed  (terminal)
                       │                              │
                       │ failWith(reason)             │ failWith(reason)
                       ▼                              ▼
                     failed  (terminal)  ◀────────  failed  (terminal)
                                          expireIfStale(now)  [from queued|processing]
```

Legal transitions — everything else throws:

| From                     | Method                      | To                                                     |
| ------------------------ | --------------------------- | ------------------------------------------------------ |
| ∅                        | `queue(ownerId, video)`     | `queued`                                               |
| `queued`                 | `beginProcessing()`         | `processing`                                           |
| `processing`             | `beginProcessing()`         | `processing` (idempotent no-op — same client retrying) |
| `queued` \| `processing` | `failWith(reason)`          | `failed`                                               |
| `processing`             | `completeWith(resultInput)` | `completed`                                            |
| `queued` \| `processing` | `expireIfStale(now)`        | `failed` (reason = stale message) — else no-op         |

### 4.3 Domain method signatures + pseudocode

```ts
// src/lib/domain/fitting-session.ts  — pure, no I/O, no astro:env import

export type SessionStatus = "queued" | "processing" | "completed" | "failed";

export class DomainError extends Error {}                       // base
export class IllegalSessionTransition extends DomainError {}    // wrong source state
export class SessionAlreadyClosed extends DomainError {}        // target is terminal
export class ResultAlreadyRecorded extends DomainError {}       // second completeWith
export class InvalidAnalysisResult extends DomainError {}       // shape/bounds
export class VideoOutsideDurationWindow extends DomainError {}  // INV‑10, server-side

export const STALE_PROCESSING_MS = 15 * 60_000;
export const STALE_PROCESSING_MESSAGE =
  "Analysis timed out — the browser tab may have been closed before it finished. Please try again.";

const MIN_DURATION_S = 2;
const MAX_DURATION_S = 15;

interface VideoMetadata { filename: string; durationSeconds: number; }        // never raw bytes
interface AnalysisResultInput {
  recommendations: { adjustment: string; rationale: string }[];
  bodyAngles: BodyAngle[];              // 1..N, each within a sane numeric range
  rawLlmResponse: string | null;
}

export class FittingSession {
  private constructor(private state: FittingSessionState) {}

  // ─── factory ────────────────────────────────────────────────────────────────
  static queue(ownerId: string, video: VideoMetadata): FittingSession {
    if (video.durationSeconds < MIN_DURATION_S || video.durationSeconds > MAX_DURATION_S)
      throw new VideoOutsideDurationWindow(
        `duration ${video.durationSeconds}s outside [${MIN_DURATION_S}, ${MAX_DURATION_S}]`);
    return new FittingSession({ status: "queued", ownerId, video, result: null, ... });
    // → repo.save() INSERTs the row
  }

  static rehydrate(row: FittingSessionRow, result: AnalysisResultRow | null): FittingSession { ... }

  // ─── transitions (preconditions → named error, never a silent write) ────────
  beginProcessing(): void {
    if (this.state.status === "processing") return;                 // idempotent
    if (this.state.status !== "queued")
      throw new SessionAlreadyClosed(`beginProcessing from '${this.state.status}'`);
    this.state.status = "processing";
    this.markDirty("queued -> processing");
  }

  completeWith(input: AnalysisResultInput): void {
    if (this.state.status !== "processing")
      throw new IllegalSessionTransition(`completeWith from '${this.state.status}'`);
    if (this.state.result !== null)
      throw new ResultAlreadyRecorded(this.state.id);
    this.state.result = AnalysisResult.create(input);              // validates shape + bounds
    this.state.status = "completed";
    this.markDirty("processing -> completed (+result)");           // ONE unit of work
  }

  failWith(reason: string): void {
    if (this.state.status === "completed" || this.state.status === "failed")
      throw new SessionAlreadyClosed(`failWith from '${this.state.status}'`);
    this.state.status = "failed";
    this.state.failureReason = reason.slice(0, 500);
    this.markDirty(`${prev} -> failed`);
  }

  /** Read-repair: turns the display-time illusion into a real persisted transition. */
  expireIfStale(now: number): boolean {
    const pending = this.state.status === "queued" || this.state.status === "processing";
    if (!pending) return false;
    if (now - this.state.updatedAt.getTime() <= STALE_PROCESSING_MS) return false;
    this.failWith(STALE_PROCESSING_MESSAGE);
    return true;
  }

  /** Guard for pipeline-step routes that do NOT transition (/analyze, /recommend). */
  assertAcceptingPipelineWork(): void {
    if (this.state.status !== "processing")
      throw new IllegalSessionTransition(`pipeline work while '${this.state.status}'`);
  }

  get pendingTransition(): PendingTransition | null { ... }         // what repo.save must persist
}
```

### 4.4 Repository — loads/saves the aggregate, owns atomicity + ownership

```ts
// src/lib/services/fitting-session-repository.ts

export interface FittingSessionRepository {
  /** Ownership is a load concern now, not per-route boilerplate. null = absent OR not owned. */
  findById(id: string, ownerId: string): Promise<FittingSession | null>;
  add(session: FittingSession): Promise<void>; // INSERT (queue)
  save(session: FittingSession): Promise<void>; // atomic compare-and-set transition
}

class SupabaseFittingSessionRepository implements FittingSessionRepository {
  async findById(id, ownerId) {
    // single admin query, joined; scoped by user_id — RLS-bypassing client, explicit owner filter
    const { data, error } = await this.admin
      .from("fitting_sessions")
      .select("*, analysis_results(*)")
      .eq("id", id)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error) throw new RepositoryError(error); // NOT "not found" (Risk #7)
    if (!data) return null;
    return FittingSession.rehydrate(data, data.analysis_results?.[0] ?? null);
  }

  async save(session) {
    const t = session.pendingTransition;
    if (!t) return;
    // ONE Postgres transaction — compare-and-set + optional result insert + updated_at.
    // Mirrors the existing check_and_increment_rate_limit RPC pattern
    // (20260905150000 / 20260905160000): SECURITY DEFINER, EXECUTE locked to service_role.
    const { data, error } = await this.admin.rpc("advance_fitting_session", {
      p_session_id: session.id,
      p_owner_id: session.ownerId,
      p_from: t.from, // expected source status  ← the compare
      p_to: t.to, // new status              ← the set
      p_failure_reason: t.failureReason ?? null,
      p_result: t.result ?? null, // jsonb; NULL unless → completed
    });
    if (error) throw new RepositoryError(error);
    if (data === "conflict")
      // 0 rows matched WHERE id=? AND user_id=? AND status=p_from
      throw new ConcurrentSessionModification(session.id, t);
  }
}
```

```sql
-- supabase/migrations/<ts>_fitting_session_state_machine.sql

ALTER TABLE analysis_results ADD CONSTRAINT analysis_results_session_id_key UNIQUE (session_id);  -- INV‑2/‑7

CREATE OR REPLACE FUNCTION advance_fitting_session(
  p_session_id uuid, p_owner_id uuid,
  p_from text, p_to text,
  p_failure_reason text, p_result jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rows int;
BEGIN
  -- compare-and-set: the WHERE clause IS the guard, atomic with the write
  UPDATE fitting_sessions
     SET status = p_to,
         error_message = CASE WHEN p_to = 'failed' THEN p_failure_reason ELSE error_message END
   WHERE id = p_session_id
     AND user_id = p_owner_id      -- INV‑5, enforced in the transition itself
     AND status = p_from;          -- INV‑1/‑7, the compare
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN 'conflict';             -- caller raises ConcurrentSessionModification
  END IF;

  IF p_to = 'completed' THEN
    INSERT INTO analysis_results (session_id, recommendations, body_angles, raw_llm_response)
    VALUES (p_session_id,
            p_result->'recommendations', p_result->'body_angles', p_result->>'raw_llm_response');
    -- same transaction as the status flip → INV‑2 holds; UNIQUE(session_id) → INV‑7
  END IF;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION advance_fitting_session(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION advance_fitting_session(uuid,uuid,text,text,text,jsonb) TO service_role;
```

### 4.5 Thin routes — parse → aggregate method → map error

```ts
// src/pages/api/sessions/[id]/results.ts  (≈20 lines, down from ~100)
export const POST: APIRoute = async (ctx) => {
  if (!ctx.locals.user) return json({ error: "Unauthorized" }, 401);

  const parsed = resultsPayloadSchema.safeParse(await readJson(ctx));
  if (!parsed.success) return json({ error: z.treeifyError(parsed.error) }, 400);

  const repo = makeFittingSessionRepository();
  const session = await repo.findById(ctx.params.id!, ctx.locals.user.id);
  if (!session) return new Response(null, { status: 404 });

  try {
    if (parsed.data.error) session.failWith(parsed.data.error_message);
    else session.completeWith(toResultInput(parsed.data));
    await repo.save(session); // atomic; throws on conflict
    return json({ ok: true });
  } catch (e) {
    return mapDomainError(e); // see table below — NEVER {ok:true} on failure
  }
};

// mapDomainError — the ONE place domain → HTTP mapping lives
//  IllegalSessionTransition | SessionAlreadyClosed  → 409  { error: "<message>" }
//  ResultAlreadyRecorded                            → 409  { error: "Results already recorded" }
//  ConcurrentSessionModification                    → 409  { error: "Session changed, please retry" }
//  InvalidAnalysisResult | VideoOutsideDurationWindow → 400
//  RepositoryError                                  → 500  (distinct from 404 — Risk #7)
```

`/start` → `session.beginProcessing()`; `/analyze` & `/recommend` →
`session.assertAcceptingPipelineWork()` (no `save`). `sessions/index.ts` →
`FittingSession.queue(...)` + `repo.add(...)` (duration now enforced server-side —
INV‑10).

### 4.6 Enforcement moves off the client

| Today (client decides)                                                              | After (server decides)                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VideoAnalyzer.tsx:121` — `res.status !== 409` treated as "carry on"                | `beginProcessing()` is idempotent from `processing`; a real conflict (terminal state) returns 409 and the client shows it. No magic-number branch.                                                    |
| `VideoAnalyzer.tsx:99-112` — client POSTs `{error:true, error_message}` it composed | Client still _reports_ a reason string to `/results`; the server's `failWith` is the **enforcer** (legal-source check + terminal write). The stale→failed decision leaves the client entirely (§4.7). |
| `session-display-status.ts` invents an "effective" 4th state at render              | `expireIfStale(now)` on `repo.findById` is a real persisted `→ failed`. Pages read `status` directly.                                                                                                 |

### 4.7 Terminal-state guarantee (INV‑3) without a cron

`repo.findById` calls `session.expireIfStale(Date.now())`; if it flips, `repo`
does a best-effort `save` (a `processing → failed` compare-and-set — safe, it
conflicts harmlessly if a real `/results` landed first). Every SSR render of
`sessions/[id].astro` and every row of `sessions/index.astro` already loads the
session, so the stuck row is repaired the first time anyone looks at it — same
trigger as today's display rule, but now it **writes**. A scheduled sweep
(`SELECT … WHERE status IN ('queued','processing') AND updated_at < now() - interval '15 min'`
→ `advance_fitting_session(…, 'failed', …)`) becomes a 10-line optional add, not a
prerequisite.

---

## Step 5 — Before/After, phased plan, tests

### 5.1 Before / After per current site

| Site                                      | Before                                                                                                                 | After                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `20260526120000_initial_schema.sql:18-19` | `CHECK` on enum values only                                                                                            | unchanged + new `advance_fitting_session()` owns transitions; `analysis_results` gains `UNIQUE(session_id)`                            |
| `sessions/index.ts:29-49`                 | insert `status:'queued'`; duration = any positive number                                                               | `FittingSession.queue()` (duration window enforced) → `repo.add()`                                                                     |
| `start.ts:20-57` (38 lines)               | read status → guard → non-conditional `UPDATE` → 500-only-on-error                                                     | `repo.findById` → `session.beginProcessing()` → `repo.save()` → `mapDomainError` (~18 lines)                                           |
| `analyze.ts:58-72`                        | own `select id,status` + own 409 string                                                                                | `session.assertAcceptingPipelineWork()`                                                                                                |
| `recommend.ts:35-49`                      | own `select id,status` + own 409 string                                                                                | `session.assertAcceptingPipelineWork()`                                                                                                |
| `results.ts:34-103` (70 lines)            | insert **then** update (2 statements); `completed`-fail → 500 after commit; `failed`-fail → **swallowed, `{ok:true}`** | `session.completeWith()` / `failWith()` → `repo.save()` (**1 transaction**); any failure → typed error response, **never `{ok:true}`** |
| `results.ts:97-99`                        | `console.error` + fall through to success                                                                              | deleted — `mapDomainError` / `RepositoryError` → 500                                                                                   |
| `sessions/[id].ts:8-39` GET               | uncalled status endpoint                                                                                               | delete, or reduce to `repo.findById` + DTO if a caller is reinstated                                                                   |
| `session-display-status.ts`               | `effectiveSessionStatus()` — render-time only, never persisted                                                         | logic moves into `FittingSession.expireIfStale()`; module kept only as a thin re-export or deleted                                     |
| `sessions/[id].astro:39-58`               | `displayStatus` derived; `results` via `.maybeSingle()` that errors on 2 rows                                          | `repo.findById` (repairs stale, returns aggregate incl. `result`); `UNIQUE` makes 2 rows impossible                                    |
| `sessions/index.astro:74-75`              | per-row `effectiveSessionStatus(...Date.now())`                                                                        | trust `session.status`; repair happened at load                                                                                        |
| `VideoAnalyzer.tsx:120-121`               | `res.status !== 409` ⇒ proceed                                                                                         | proceed on 2xx; render server's typed 409 message                                                                                      |
| `VideoAnalyzer.tsx:99-112`                | client authors terminal transition                                                                                     | client reports reason; server enforces                                                                                                 |
| `VideoUpload.tsx:73-80`                   | duration window client-only                                                                                            | unchanged client UX; server now also enforces (defense in depth)                                                                       |
| `src/types.ts:3-13`                       | anemic `FittingSession` DTO                                                                                            | stays as the wire/row DTO; `FittingSession` domain class is separate (`src/lib/domain/`)                                               |

### 5.2 Phased refactor plan

The project has a **test-first discipline** (`context/foundation/test-plan.md`
§1: "the cheapest test that gives a real signal wins"; Vitest in use; lefthook
runs `vitest related` pre-commit). Phases 1, 2, 4 are **test-first**.

| Phase                               | Scope                                                                                                                                                                                            | Test-first?                                                                                                                                                                                   | Gate                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **P1 — Domain model**               | `src/lib/domain/fitting-session.ts` + `analysis-result.ts`: aggregate, `SessionStatus`, named errors, `expireIfStale`. Pure, zero I/O.                                                           | **Yes** — write the transition table as tests first (§5.3), then the class. Add module to `stryker.config.json` `mutate` scope.                                                               | `npx tsc --noEmit`, `vitest`, mutation score on the new module              |
| **P2 — Persistence**                | migration (`advance_fitting_session` + `UNIQUE(session_id)`); `FittingSessionRepository` port + Supabase impl; extend `supabase-stub` to script `.rpc("advance_fitting_session", …)`.            | **Yes** — repo contract tests (conflict path, ownership scoping, error-vs-absent) before the impl.                                                                                            | `vitest` (stub) + one local `npx supabase start` integration run of the RPC |
| **P3 — Route refactor**             | `/start`, `/results` → thin; `/analyze`, `/recommend` → `assertAcceptingPipelineWork`; `sessions/index.ts` → `queue()`. **Response contracts (status codes + JSON bodies) held byte-identical.** | Existing route tests (`_start.test.ts`, `_results.test.ts`, `_recommend.test.ts`, `_analyze.test.ts`) must stay green; add the swallowed-`failed`-write case as a **now-failing→fixed** test. | full `vitest`, `lint`, `tsc`                                                |
| **P4 — Terminal state server-side** | `expireIfStale` in `repo.findById` + best-effort repair `save`; `sessions/[id].astro` & `sessions/index.astro` read `status` directly; retire `effectiveSessionStatus` (or keep as 1-line shim). | **Yes** — page tests: a stale `processing` row renders "timed out" **and** a follow-up `findById` shows persisted `failed`.                                                                   | `vitest` (pages project), e2e smoke unchanged                               |
| **P5 — Client de-authoring**        | `VideoAnalyzer.tsx`: drop the `409`-as-success branch; surface typed server outcome; keep reporting a failure reason string.                                                                     | Component test for the retry (double `/start`) and terminal-conflict paths.                                                                                                                   | e2e smoke (`testing-quality-gates-e2e-smoke`) must still pass               |
| **P6 — Optional sweep**             | scheduled `advance_fitting_session(…, 'failed', stale message)` for rows older than `STALE_PROCESSING_MS`.                                                                                       | test the SQL predicate                                                                                                                                                                        | —                                                                           |

Rollback: P1–P2 add code without touching routes; P3 is the switchover and is
contract-preserving, so it reverts file-by-file. P4/P5 are independent.

### 5.3 Invariant test cases (INV‑1)

**Legal transitions — must succeed, must leave the stated state:**

1. `queue(owner, {durationSeconds: 6}) ` → status `queued`, no result.
2. `queued → beginProcessing()` → `processing`.
3. `processing → completeWith(validResult)` → `completed`, exactly one result attached.
4. `processing → failWith("no cyclist detected")` → `failed`, `failureReason` set.
5. `queued → failWith("start failed")` → `failed` (early failure path).
6. `processing → beginProcessing()` (retry) → still `processing`, idempotent, no error.
7. `expireIfStale(now)` on `processing` with `updatedAt` = now − 16 min → returns `true`, status `failed`, reason = `STALE_PROCESSING_MESSAGE`.
8. `save()` of a `→ completed` aggregate issues **one** `advance_fitting_session` call carrying both the status and the result payload.

**Illegal transitions — must throw the named error, must NOT change state:**

9. `queued → completeWith(...)` → `IllegalSessionTransition`; status still `queued`.
10. `completed → completeWith(...)` → `SessionAlreadyClosed`.
11. `processing → completeWith(...)` twice → 2nd throws `ResultAlreadyRecorded`.
12. `completed → beginProcessing()` → `SessionAlreadyClosed`.
13. `failed → failWith(...)` → `SessionAlreadyClosed`.
14. `completed → failWith(...)` → `SessionAlreadyClosed`.
15. `queue(owner, {durationSeconds: 0.5})` → `VideoOutsideDurationWindow`; `{durationSeconds: 40}` → same.
16. `completeWith({bodyAngles: []})` → `InvalidAnalysisResult` (min 1); `bodyAngles` length > 20 → same (parity with `schemas.ts:27`).
17. `expireIfStale(now)` on `completed` → returns `false`, no throw, no change.
18. `expireIfStale(now)` on `processing` with fresh `updatedAt` → `false`, no change.

**Atomicity / concurrency (repository + RPC):**

19. Two `save()`s from `processing` — one `completeWith`, one `failWith` — the
    2nd raises `ConcurrentSessionModification` (RPC `WHERE status='processing'`
    matches 0 rows); DB ends in exactly one terminal state with 0 or 1 result
    rows, never 2.
20. `advance_fitting_session` to `completed`: if the `INSERT analysis_results`
    violates `UNIQUE(session_id)`, the whole transaction aborts — status is
    **not** flipped (verifies INV‑2 can't half-apply).
21. `findById(id, otherOwnerId)` → `null` (not an error, not the row) — ownership
    in the load.
22. `findById` when the underlying query errors → `RepositoryError` (→ 500),
    never `null` (Risk #7).

**Route contract (P3, held identical):**

23. `POST /start` on a `queued` session → 200 `{ok:true}`; on `completed` → 409;
    unauth → 401 with no DB call.
24. `POST /results` `{error:true}` whose `failWith` write conflicts → **409 with
    an error body**, never `{ok:true}` (the fix for `_results.test.ts:120-130`).
25. `POST /results` success → 200; a second identical POST → 409
    `ResultAlreadyRecorded`, still one result row.

### 5.4 New load-bearing names to register

The project has no formal contract registry, but it uses the pattern (a "single
citable home" — `reference-angles.md:15`; append-only `lessons.md`). Recommend
`context/domain/` as the home for these, with this file as its first entry.

| Name                                                                                                                                                                                   | Kind                             | Home                                                                        | Note                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `FittingSession`                                                                                                                                                                       | aggregate root                   | `src/lib/domain/fitting-session.ts`                                         | the consistency boundary for INV‑1..‑4,‑7                                                                       |
| `AnalysisResult`                                                                                                                                                                       | entity (inside `FittingSession`) | `src/lib/domain/analysis-result.ts`                                         | 0..1 per session; never loaded alone                                                                            |
| `SessionStatus` + transition table                                                                                                                                                     | value object                     | `src/lib/domain/fitting-session.ts`                                         | replaces the scattered `status !== "x"` string guards                                                           |
| `FittingSession.beginProcessing / completeWith / failWith / expireIfStale / assertAcceptingPipelineWork`                                                                               | domain methods                   | ″                                                                           | the only places a transition is decided                                                                         |
| `IllegalSessionTransition`, `SessionAlreadyClosed`, `ResultAlreadyRecorded`, `InvalidAnalysisResult`, `VideoOutsideDurationWindow`, `ConcurrentSessionModification`, `RepositoryError` | named domain errors              | `src/lib/domain/errors.ts`                                                  | fail-fast; each maps to one HTTP status in `mapDomainError`                                                     |
| `FittingSessionRepository` (port) + `SupabaseFittingSessionRepository`                                                                                                                 | repository                       | `src/lib/services/fitting-session-repository.ts`                            | the only module that reads/writes `fitting_sessions` + `analysis_results`                                       |
| `advance_fitting_session(uuid,uuid,text,text,text,jsonb)`                                                                                                                              | Postgres function                | `supabase/migrations/<ts>_fitting_session_state_machine.sql`                | the atomic transition boundary; sibling of `check_and_increment_rate_limit`; `EXECUTE` locked to `service_role` |
| `analysis_results_session_id_key`                                                                                                                                                      | DB constraint                    | same migration                                                              | `UNIQUE (session_id)` — makes INV‑2/‑7 unbreakable at the storage layer                                         |
| `mapDomainError`                                                                                                                                                                       | function                         | `src/lib/domain/http.ts` (or route helper)                                  | single domain→HTTP mapping site                                                                                 |
| `STALE_PROCESSING_MS`, `STALE_PROCESSING_MESSAGE`                                                                                                                                      | constants                        | move from `session-display-status.ts` → `src/lib/domain/fitting-session.ts` | now a real transition input, not a render constant                                                              |

### 5.5 Constraints honored

- **Fail-fast:** every illegal operation throws a named error and stops. The
  `results.ts:97-99` "log and return `{ok:true}`" path is deleted; `mapDomainError`
  turns each domain error into a distinct 4xx/5xx.
- **No production code changed by this document** — design only.
- **All `file:line` citations verified** against the working tree at
  `master` @ `5b42fd0`.

---

## Summary

BikeFit's core domain invariant is the **`FittingSession` lifecycle**:
`queued → processing → {completed | failed}`, with guarded one-way transitions, a
`completed`-iff-exactly-one-`AnalysisResult` rule, and a guarantee that every
started analysis reaches a terminal state. It is the most central rule in the
product — the North Star outcome S-02 and the PRD "no silent errors" guardrail
are both statements about it — yet it is the **least enforced**: the four
pipeline routes (`start.ts`, `analyze.ts`, `recommend.ts`, `results.ts`) each
hand-roll a non-atomic read-then-write status guard, `results.ts` writes the
result row and the status flip as two separate statements (a documented orphan
risk), `analysis_results` has no `UNIQUE(session_id)` so a race produces two rows
that permanently break the results page, `results.ts:97-99` swallows a failed
`→ failed` write and returns `{ ok: true }`, and the "reaches a terminal state"
guarantee is faked at render time by `effectiveSessionStatus()` while the stored
row stays `processing` forever. The browser (`VideoAnalyzer.tsx`) co-authors the
machine — deciding what a 409 means and composing failure messages. The fix is a
`FittingSession` **aggregate root** (with `AnalysisResult` as an entity inside its
boundary) exposing `beginProcessing`/`completeWith`/`failWith`/`expireIfStale` as
precondition-checked methods that throw named domain errors; a
`FittingSessionRepository` that loads and saves the whole aggregate and pushes
every transition through a single `advance_fitting_session` Postgres function
doing compare-and-set + result insert + ownership check in **one transaction**;
and thin routes that only parse input, call one aggregate method, and map domain
errors to HTTP. The rollout is six phases, test-first for the pure domain model,
the repository, and the server-side staleness repair, holding route response
contracts byte-identical through the switchover.
