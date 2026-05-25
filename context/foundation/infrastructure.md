---
project: bikefit
researched_at: 2026-05-23
recommended_platform: Cloudflare Workers (with Static Assets)
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd V8 isolate)
  database: Supabase (external)
---

## Recommendation

**Deploy on Cloudflare Workers with Static Assets.**

The tech stack already names Cloudflare as the deployment target, and Cloudflare Workers scores Pass on all five agent-friendly criteria: `wrangler` CLI covers every routine operation, Workflows V2 (GA, May 2026) handles the 5–10-minute async analysis pipeline without a duration ceiling, docs are best-in-class (per-product `llms.txt`, GitHub source, markdown headers), the deploy API is deterministic, and an official MCP server is GA. At $5/month Paid plan the cost is negligible for MVP scale.

**Critical adapter note**: `@astrojs/cloudflare` v13+ dropped SSR support on Cloudflare Pages — the adapter now deploys to **Cloudflare Workers with Static Assets**, not Pages Functions. The tech-stack document's `deployment_target: cloudflare-pages` reflects the bootstrapper's original intent, but the actual deploy command is `wrangler deploy`, not `wrangler pages deploy`. Follow the migration guide before first deploy.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration |
|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass |
| Vercel | Pass | Pass | Pass | Pass | Pass |
| Netlify | Pass | Pass | Pass | Pass | Pass |
| Railway | Partial¹ | Pass | Partial² | Pass | Partial³ |
| Render | Partial¹ | Pass | Pass | Partial¹ | Partial³ |
| Fly.io | Partial¹ | Partial⁴ | Partial² | Pass | Fail⁵ |

¹ No dedicated CLI rollback command — dashboard or API required  
² Docs hosted on GitHub as Markdown, but no `llms.txt` index  
³ MCP server is preview/WIP or limited in scope (cannot trigger deploys)  
⁴ Container-based PaaS — you own the Docker model; more operational surface than true managed  
⁵ MCP server experimental (4 commits, 31 stars as of 2026-05-23)

**Background job capability** (critical secondary dimension, Q1=Yes):
- Cloudflare Workflows V2 (GA): unlimited total runtime across steps — purpose-built for this use case
- Railway native worker service (GA): persistent process, no timeout ceiling — equally strong
- Render Background Workers (GA): persistent process, no timeout ceiling
- Vercel Workflows (GA): step-level 800s cap on Pro ($20/mo) — fits but adds architectural overhead and commercial use prohibition on Hobby
- Netlify Background Functions (GA, 15-min limit): technically fits but cold-start per invocation, no native queue, not designed for ML inference pipelines

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Scores Pass on all five agent-friendly criteria. The async analysis pipeline (pose estimation + LLM) maps directly to Cloudflare Workflows V2: each step runs up to 5 minutes of CPU time (plus unlimited I/O wait), Queues provide durable delivery and retry, and R2 stores video temporarily with presigned URLs for the external pose estimation API. Wrangler CLI covers deploy, rollback, log tailing, secret management, and R2/Queue provisioning without touching a browser. Agent-readable docs are best in class across all researched platforms (`developers.cloudflare.com/llms.txt`, per-product llms.txt files, `Accept: text/markdown` on every docs page, GitHub source). The official MCP server (GA, Code Mode April 2026) exposes Workers, Pages, R2, and D1 as structured tools. At $5/month Paid plan this is the lowest-cost path that unlocks background jobs.

#### 2. Railway

The strongest alternative for a use case where Q1=Yes. Railway runs every service as a persistent Docker container — no serverless constraints, no per-invocation timeout, no cold starts. The web service and background worker deploy as two services within a single project; Railway Redis (included) serves as the job queue; connection strings are injected automatically via reference variables. Railpack auto-detects Node.js + Astro and generates the Dockerfile. Hobby plan is $5/month with $5 of included resource credit. Main gaps vs Cloudflare: no CLI rollback command (dashboard only), MCP server is preview/WIP, and there is no hard spend cap (cost can surprise if a worker runs unexpectedly long). No `llms.txt`.

#### 3. Render

Persistent Background Workers (GA) handle the 5–10-minute pipeline cleanly; web service + worker is a native two-service pattern. Render publishes `llms.txt` and `llms-full.txt` and any docs page is fetchable as Markdown — good for agent use. Official MCP server is GA but limited (read-only on most resources; cannot trigger deploys or modify scaling). Rollback is available via the REST API but not the CLI. The free tier spins down after 15 minutes of inactivity — paid tier ($7/month per service) is required for a user-facing app, making the realistic MVP cost $14/month (web + worker). No native object storage; R2 or Supabase Storage needed for video. Render Workflows (durable orchestration) is in public beta (launched 2026-04-07) — stick with Background Worker + Render Key Value for production reliability.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Adapter/platform mismatch on day one**: The tech stack specifies `deployment_target: cloudflare-pages` but `@astrojs/cloudflare` v13+ dropped Pages SSR support. Running `wrangler pages deploy` as the tech-stack implies will produce a broken deployment. The fix is documented (migration to Workers + Static Assets) but discovering this on the first deploy is a momentum-killer.

2. **Workerd is not Node.js**: The Workers runtime supports Node.js APIs via `nodejs_compat` flag but has real gaps — no `worker_threads`, no native C++ addons, no filesystem writes, partial `crypto`. Dependencies that rely on Node.js internals fail silently at runtime, not at build time. Compatibility issues compound non-linearly as npm packages are added.

3. **Workflows V2 billing is not yet locked**: Cloudflare Workflows V2 was released May 2026 and pricing is not fully documented. The current Paid-plan behavior may shift before the project ships. Building the entire async pipeline on a product with unfinished pricing documentation introduces budget uncertainty.

4. **Local dev parity gap for async pipeline**: `wrangler dev` partially simulates Workflows and Queues but not fully. Testing the end-to-end 5–10-minute pipeline locally requires `wrangler dev --remote` (hits your live Paid account) or deploying to a staging Worker. This slows iteration on the most complex part of the app.

5. **Platform coupling**: Using Cloudflare Workflows + Queues + R2 creates meaningful lock-in. If the team outgrows Cloudflare or pricing surprises emerge, the async pipeline must be fully rewritten — not just redeployed.

### Pre-Mortem — How This Could Fail

Six months after deploying BikeFit on Cloudflare Workers, the project is stalled. Week one was lost debugging a broken SSR deploy — the tech-stack document said "Cloudflare Pages" but the adapter had dropped Pages SSR months earlier. The migration to Workers with Static Assets eventually worked but burned momentum at the worst time for a 3-week sprint.

The deeper failure was the async pipeline. Cloudflare Workflows ran correctly in local dev but the simulation didn't replicate actual step retry behavior. In production, a transient pose estimation API error caused Workflow steps to retry — and the retry semantics triggered the LLM call twice for the same job, producing duplicate analysis records in Supabase. Adding idempotency keys throughout the Workflow wasn't obvious from the documentation and required a week of rework.

Meanwhile, `wrangler tail` uses log sampling — at five requests per minute, roughly 40% of tail events were silently dropped during debugging sessions. Tracing a stateful Workflow from incomplete logs is genuinely painful. By month four, Workflows V2 pricing was updated with a new per-execution-step cost that pushed the monthly bill from $5 to $22 — not ruinous but unbudgeted and discovered only on the invoice. The combination of non-obvious failure modes, partial local parity, and a pricing surprise ate the solo developer's limited after-hours energy.

### Unknown Unknowns

- **`wrangler tail` is sampled, not complete**: At higher request volumes, tail output drops events silently. For a low-traffic gravel bike fitting app this is unlikely to be critical, but a developer expecting full trace capture during debugging will be surprised.
- **Supabase Realtime + Workers**: The PRD requires in-page notification when analysis completes. Supabase Realtime works fine client-side (browser WebSocket). Server-side publishing to Supabase Realtime from a Worker requires the REST broadcast API — WebSocket clients inside Workers don't persist between requests. This shapes the result-notification architecture.
- **`nodejs_compat` flag has non-obvious interactions**: The flag enables Node.js APIs but some packages detect the runtime via `process.versions`, see "Node.js," and then call unsupported APIs. These failures appear at runtime, not at build time, and the error messages don't point to the compat flag.
- **`wrangler pages deploy` vs `wrangler deploy` are NOT interchangeable**: Deploying to the wrong product type gives a confusing error. Any existing CI pipeline referencing `wrangler pages deploy` must be explicitly updated to `wrangler deploy` after migrating to Workers + Static Assets.
- **Workers CPU billing ≠ wall-clock time**: The pose estimation step calls an external API and waits — I/O time costs near zero. Developers used to container-uptime billing (Railway/Render) may over-engineer cost optimization against the wrong metric.

## Operational Story

- **Preview deploys**: Workers environments (configured in `wrangler.toml` under `[env.staging]`) provide named staging deployments at `<worker-name>.<subdomain>.workers.dev`. No automatic per-PR preview URLs — branch previews require a separate `wrangler deploy --env staging` step in CI. Unlike Cloudflare Pages (which had per-branch preview URLs built in), Workers environments are manually defined.
- **Secrets**: `wrangler secret put KEY` stores encrypted secrets in the Worker — they are injected as environment variables at runtime and are never visible in plaintext after upload. Rotation: `wrangler secret put KEY` again with the new value; old value is replaced immediately. Supabase service role key, LLM API key, and any pose estimation API credentials live here. Do not commit `.dev.vars` (local dev secrets) to the repo.
- **Rollback**: `wrangler rollback [version-id]` reverts to any prior deployed version (requires Wrangler ≥ 3.73.0). `wrangler versions list` shows available versions. Rollback is near-instant — Workers are deployed as immutable versioned artifacts. Database migrations (Supabase) do not auto-rollback; data migrations must be handled separately.
- **Approval**: The agent may run `wrangler deploy`, `wrangler rollback`, `wrangler tail`, `wrangler secret put`, and `wrangler r2 object put/delete` unattended. Human-only operations: deleting an R2 bucket, deleting a Worker, rotating the Cloudflare API token itself, modifying billing settings, and any Supabase destructive migrations. Token scope: limit the CI/CD API token to Workers + R2 + Queues for one account — no DNS, no billing access.
- **Logs**: `wrangler tail` streams live invocation logs with filters (`--status error`, `--search "keyword"`, `--format json`, `--sampling-rate`). For Workflows execution history: Cloudflare dashboard → Workers → Workflows → select instance. `wrangler tail` does not stream Workflow step-level traces — use the dashboard for deep pipeline debugging.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Pages → Workers adapter mismatch causes broken first deploy | Research finding (adapter v13+ changelog) | High | Medium | Follow migration guide before first deploy; update `wrangler.toml` for `[assets]` binding; change CI from `wrangler pages deploy` to `wrangler deploy` |
| Workflows V2 pricing changes before launch | Devil's advocate | Medium | Medium | Pin the current Paid plan ($5/mo base) in budget; set a Cloudflare spend alert; accept that step costs may increase |
| `nodejs_compat` flag breaks a transitive npm dependency at runtime | Devil's advocate | Medium | Medium | Run `wrangler dev --remote` early in development to catch compatibility issues before they reach production; check each new package against the Workers compatibility list |
| Retry semantics in Workflows trigger duplicate LLM calls | Pre-mortem | Medium | High | Add idempotency keys to all Workflow steps that write to Supabase; use Supabase `upsert` with a job-ID constraint rather than `insert` |
| `wrangler tail` sampling drops debug events | Unknown unknowns | Medium | Low | Use `wrangler tail --sampling-rate 1` (captures all events, increases cost at high volume); for production debugging, query Cloudflare Logpush or use the dashboard Workflows trace viewer |
| Local dev parity gap slows async pipeline iteration | Devil's advocate | High | Medium | Build and test Workflow steps in isolation against the real Paid account staging environment early; do not rely on local Workflow simulation for integration testing |
| Platform coupling makes future migration expensive | Devil's advocate | Low | High | Encapsulate all Cloudflare-specific code (Workflows API calls, R2 bindings, Queue producers) behind thin service interfaces from day one |
| Supabase Realtime notification architecture mismatch | Unknown unknowns | Medium | Low | Use client-side polling or Supabase Realtime from the browser directly; avoid server-side WebSocket to Supabase from within a Worker |

## Getting Started

The `@astrojs/cloudflare` adapter (v13+) targets **Cloudflare Workers**, not Cloudflare Pages. The steps below reflect that:

1. **Install Wrangler and authenticate**:
   ```bash
   npm install -D wrangler
   npx wrangler login
   ```

2. **Verify / update the Astro adapter** — the 10x-astro-starter may have configured the adapter for Pages. Confirm `astro.config.mjs` uses the cloudflare adapter with Workers output:
   ```js
   import cloudflare from '@astrojs/cloudflare';
   export default defineConfig({
     adapter: cloudflare(),
     output: 'server',
   });
   ```
   If it currently has `@astrojs/cloudflare` configured for Pages Functions, follow the migration guide: `developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/`

3. **Configure `wrangler.toml`** for Workers + Static Assets:
   ```toml
   name = "bikefit"
   main = "dist/_worker.js"
   compatibility_date = "2024-09-23"
   compatibility_flags = ["nodejs_compat"]

   [assets]
   directory = "./dist"

   [[queues.producers]]
   queue = "bikefit-jobs"
   binding = "JOB_QUEUE"

   [[queues.consumers]]
   queue = "bikefit-jobs"
   max_batch_size = 1
   max_batch_timeout = 30

   [[r2_buckets]]
   binding = "UPLOADS"
   bucket_name = "bikefit-uploads"
   ```

4. **Upgrade to Cloudflare Paid plan** ($5/mo) — the free tier's 10ms CPU limit blocks background jobs, Queues, and Workflows. Activate via the Cloudflare dashboard under Workers & Pages → Plans.

5. **Provision R2 bucket and Queue**:
   ```bash
   npx wrangler r2 bucket create bikefit-uploads
   npx wrangler queues create bikefit-jobs
   ```

6. **Store secrets**:
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put LLM_API_KEY
   npx wrangler secret put POSE_ESTIMATION_API_KEY
   ```

7. **Build and deploy**:
   ```bash
   npm run build
   npx wrangler deploy
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring)
- Production-scale architecture (multi-region, HA, DR)
- Pose estimation service selection (Replicate, Modal, etc.) — the platform hosts the orchestration; the inference runs externally
