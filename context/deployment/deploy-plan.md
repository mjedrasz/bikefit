# Deploy Plan: bikefit → Cloudflare Workers

## Summary

| Key | Value |
|---|---|
| Worker name | `bikefit` |
| Platform | Cloudflare Workers with Static Assets |
| Runtime | `@astrojs/cloudflare` v13.5.4 (Workers adapter) |
| Deploy trigger | Cloudflare Workers Builds Git integration — auto on push to `master` |
| CI (GitHub Actions) | Lint + build only; no deploy step |
| Runtime secrets | `SUPABASE_URL`, `SUPABASE_KEY` (set via Cloudflare dashboard) |
| Manual deploy fallback | `npm run build && npx wrangler deploy` |
| Planned date | 2026-05-23 |

---

## Status Legend

| Badge | Meaning |
|---|---|
| ✅ Done | Completed and verified |
| 🔄 In progress | Actively being worked on |
| ⬜ Not started | Not yet begun |
| 🚫 Blocked | Waiting on something external |

---

## Progress Overview

| Phase | Name | Owner | Status |
|---|---|---|---|
| 0 | Account & Tooling Setup | Human | ✅ Done |
| 1 | Code Change | Agent | ✅ Done |
| 2 | Platform Configuration | Human | ✅ Done |
| 3 | First Deploy | Human + Agent | ✅ Done |
| 4 | Verification | Agent / Human | ✅ Done |

---

## Phase 0 — Account & Tooling Setup ✅

**Owner:** Human (one-time, manual steps — cannot be automated)

### Node.js + Wrangler CLI

```bash
# From bikefit/ directory
node --version      # must be v22.x (.nvmrc); use: nvm use
npm install         # installs wrangler v4.90.0 from devDependencies

npx wrangler login      # browser-based OAuth — authorize in Cloudflare dashboard
npx wrangler whoami     # verify: prints your account email
```

- [x] `nvm use` runs without error (Node v22 active)
- [x] `npm install` completes (wrangler v4.90.0 in `node_modules`)
- [x] `npx wrangler login` — browser OAuth completed
- [x] `npx wrangler whoami` — prints your Cloudflare account email

### Cloudflare Account + Paid Plan

1. Create/log in at cloudflare.com
2. Upgrade to Workers Paid plan ($5/mo) — free tier's 10 ms CPU cap blocks SSR:
   - dash.cloudflare.com → Workers & Pages → Plans → Subscribe

- [x] Cloudflare account exists and you are logged in
- [x] Workers Paid plan active ($5/mo)

### Supabase Cloud Project

1. Create a project at supabase.com (or use existing)
2. Project Settings → API:
   - **Project URL** → note as `SUPABASE_URL`
   - **anon/public key** → note as `SUPABASE_KEY`

- [x] Supabase project created
- [x] `SUPABASE_URL` value captured (keep secret)
- [x] `SUPABASE_KEY` value captured (keep secret)

**Phase 0 complete when:** `npx wrangler whoami` prints your email, Paid plan is active, and both Supabase values are in hand.

---

## Phase 1 — Code Change ✅

**Owner:** Agent

One file to update before any deploy can succeed.

**`wrangler.jsonc`** — rename Worker from `"10x-astro-starter"` to `"bikefit"`:

```jsonc
// Before
"name": "10x-astro-starter",

// After
"name": "bikefit",
```

- [x] `wrangler.jsonc` `name` field updated to `"bikefit"`
- [x] Change committed to `master` (or feature branch before merge)

**Phase 1 complete when:** `grep '"name"' wrangler.jsonc` returns `"bikefit"`.

---

## Phase 2 — Platform Configuration ✅

**Owner:** Human (Cloudflare dashboard — cannot be automated without a scoped API token)

### Cloudflare Workers Builds Git Integration (auto-deploy on push)

1. dash.cloudflare.com → Workers & Pages → Create application → Workers → **Connect to Git**
2. Connect GitHub account → select the bikefit repo
3. Build settings:
   - Build command: `npm run build`
   - Root directory: `/`
4. Environment variables (mark as **Secret/Encrypted**):
   - `SUPABASE_URL` — value from Phase 0
   - `SUPABASE_KEY` — value from Phase 0
5. Deployment branch: `master`
6. Save → first build triggers automatically

- [x] GitHub account connected to Cloudflare
- [x] Correct repo selected
- [x] Build command set to `npm run build`
- [x] `SUPABASE_URL` added as encrypted secret
- [x] `SUPABASE_KEY` added as encrypted secret
- [x] Deployment branch set to `master`
- [x] Configuration saved

**Phase 2 complete when:** the Git integration is saved and the first automated build has been triggered in the Cloudflare dashboard.

---

## Phase 3 — First Deploy ✅

**Owner:** Human + Agent

The Cloudflare Workers Builds integration auto-deploys on every push to `master`. The Phase 1 commit (wrangler.jsonc rename) is the natural trigger for the first deploy.

### Auto-deploy path (preferred)

- [x] Phase 1 commit pushed to `master`
- [x] Build visible in Cloudflare dashboard (Workers & Pages → bikefit → Deployments)
- [x] Build status turns green (no red/failed state)

### Manual deploy fallback (if Git integration is not yet set up)

```bash
# From bikefit/ directory
npm run build
npx wrangler deploy
```

- [ ] `npm run build` exits 0
- [ ] `npx wrangler deploy` exits 0 and prints the workers.dev URL

**Phase 3 complete when:** Cloudflare dashboard shows Worker `bikefit` with at least one successful deployment.

---

## Phase 4 — Verification ✅

**Owner:** Agent / Human

Run all checks after the first successful deploy.

- [x] Cloudflare dashboard shows Worker named `bikefit` with green build status
- [x] `https://bikefit.m-jedraszewski.workers.dev` — homepage loads (SSR working)
- [x] `/auth/signin` — page renders without errors
- [x] `npx wrangler tail` — no 5xx errors during a normal visit
- [x] Commit pushed to `master` → new build triggered in Cloudflare dashboard (confirms Git integration is live)

**Phase 4 complete when:** all five checks above are ticked.

---

## Human-Only Operations (never automated)

- Deleting the Worker
- Rotating the Cloudflare API token
- Destructive Supabase migrations

---

## Risk Register (from infrastructure.md)

| Risk | Source lens | Mitigation |
|---|---|---|
| Pages/Workers adapter mismatch on first deploy | Pre-mortem | Adapter is `@astrojs/cloudflare` (Workers); deploy command is `wrangler deploy`, NOT `wrangler pages deploy` |
| `nodejs_compat` breaks a transitive dep at runtime | Research finding | Run `wrangler dev --remote` early to catch compat issues |
| Workflows V2 pricing changes (future) | Unknown unknowns | Set Cloudflare spend alert; not relevant for initial deploy |
| Retry semantics duplicate LLM calls | Research finding | Add idempotency keys to Workflow steps when building the pipeline |
| Supabase Realtime from Worker | Research finding | Use client-side Supabase Realtime (browser WebSocket); avoid server-side |
