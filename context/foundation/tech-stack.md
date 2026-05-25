---
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
---

## Why this stack

A solo developer shipping a gravel-bike fitting web app in a 3-week after-hours sprint needs a starter that delivers auth, a database, and edge deploy out of the box — without assembly tax. The 10x Astro Starter (Astro 6 + React 19 + Supabase + Cloudflare Pages) is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: typed TypeScript throughout, convention-based routing, high training-data coverage, and well-maintained docs. Auth (FR-001/002) and AI/LLM (FR-007) feature flags are set; payments and realtime are out of scope per PRD non-goals. Background jobs are flagged true — BikeFit's 5–10-minute async analysis pipeline (pose estimation + LLM) cannot run inside an edge function and will require an external job queue or Supabase Edge Function with a queue; Astro handles only the upload trigger and result display. Bootstrapper confidence is first-class, so scaffolding should be smooth with minor manual steps expected. CI runs on GitHub Actions with auto-deploy-on-merge, matching the solo shipping cadence.
