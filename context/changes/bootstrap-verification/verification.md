---
bootstrapped_at: 2026-05-22T20:13:13Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: bikefit
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: bikefit
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
```

**Why this stack**: A solo developer shipping a gravel-bike fitting web app in a 3-week after-hours sprint needs a starter that delivers auth, a database, and edge deploy out of the box — without assembly tax. The 10x Astro Starter (Astro 6 + React 19 + Supabase + Cloudflare Pages) is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: typed TypeScript throughout, convention-based routing, high training-data coverage, and well-maintained docs. Auth (FR-001/002) and AI/LLM (FR-007) feature flags are set; payments and realtime are out of scope per PRD non-goals. Background jobs are flagged true — BikeFit's 5–10-minute async analysis pipeline (pose estimation + LLM) cannot run inside an edge function and will require an external job queue or Supabase Edge Function with a queue; Astro handles only the upload trigger and result display. Bootstrapper confidence is first-class, so scaffolding should be smooth with minor manual steps expected. CI runs on GitHub Actions with auto-deploy-on-merge, matching the solo shipping cadence.

## Pre-scaffold verification

| Signal      | Value                                                                  | Severity | Notes                                                           |
| ----------- | ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| npm package | not run                                                                | —        | cmd_template uses `git clone`; no npm create-* CLI to check     |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17T10:33:39Z   | fresh    | checked via `gh api repos/przeprogramowani/10x-astro-starter`   |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone into temp directory, strip upstream git history, move files up)
**Exit code**: 0
**Git history stripped**: `.bootstrap-scaffold/.git/` deleted before move-up
**Files moved**: 20 (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `CLAUDE.md`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: none (cwd was empty at scaffold time)
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0 direct CRITICAL/HIGH of total 0/1; 2 direct MODERATE of total 9 (direct packages with findings: `@astrojs/check`, `wrangler`)

#### CRITICAL findings

None.

#### HIGH findings

| Package | Version range | Advisory            | Description                              | CVSS | Fix available |
| ------- | ------------- | ------------------- | ---------------------------------------- | ---- | ------------- |
| devalue | 5.6.3–5.8.0   | GHSA-77vg-94rm-hx3p | DoS via sparse array deserialization     | 7.5  | Yes           |

`devalue` is transitive (not a direct dependency). Fix available via `npm audit fix`.

#### MODERATE findings

| Package                  | Direct | Advisory / cause                           | Fix available                |
| ------------------------ | ------ | ------------------------------------------ | ---------------------------- |
| `@astrojs/check`         | yes    | via `@astrojs/language-server`             | `@astrojs/check@0.9.2` (major bump) |
| `@astrojs/language-server` | no   | via `volar-service-yaml`                   | via `@astrojs/check` bump    |
| `@cloudflare/vite-plugin`  | no   | via `miniflare`, `wrangler`, `ws`          | Yes                          |
| `miniflare`               | no    | via `ws` (GHSA-58qx-3vcg-4xpx)            | Yes                          |
| `volar-service-yaml`      | no    | via `yaml-language-server`                 | via `@astrojs/check` bump    |
| `wrangler`                | yes   | via `miniflare`                            | Yes                          |
| `ws`                      | no    | GHSA-58qx-3vcg-4xpx — uninitialized memory disclosure (CVSS 4.4) | Yes |
| `yaml`                    | no    | GHSA-48c2-rrv3-qjmp — stack overflow via deeply nested YAML (CVSS 4.3) | via `@astrojs/check` bump |
| `yaml-language-server`    | no    | via `yaml`                                 | via `@astrojs/check` bump    |

All MODERATE findings are in dev tooling (`wrangler`, `@astrojs/check`, `@cloudflare/vite-plugin`). None affect production runtime.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | true                 |

These fields were read from the hand-off and staged for future skills. v1 bootstrapper does not modify the scaffold based on feature flags. The `has_auth`, `has_ai`, and `has_background_jobs: true` hints are load-bearing for the future M1L4 skill ("Memory Architecture") and for milestone planning.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version to keep.
- Address audit findings per your project's risk tolerance — the HIGH finding (`devalue`) is transitive dev-tooling; run `npm audit fix` to patch auto-fixable issues without breaking changes.
- The `has_background_jobs: true` flag is not wired up by the scaffold — the async analysis pipeline (pose estimation + LLM) will need an external queue or Supabase Edge Function; plan this before implementation begins.
