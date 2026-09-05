---
change_id: testing-abuse-resource-protection
title: Testing abuse resource protection
status: impl_reviewed
created: 2026-09-04
updated: 2026-09-05
archived_at: null
---

## Notes

This is **§3 Phase 3** of the test-plan rollout — _Abuse & resource
protection_ (covers Risk #3 — the OpenRouter dependency is an unprotected
single point of failure: no rate limiting, no server-side payload caps, the
vision route not scoped to an owned session; Risk #4 — a crafted or
fabricated video manipulates the vision model via multimodal prompt
injection). Test types planned: integration, AI-native probe (optional).

Risk response intent (from `context/foundation/test-plan.md` §2 Risk
Response Guidance):

- **Risk #3**: prove server-side rate limiting and payload-size caps are
  enforced on every OpenRouter-backed route, the vision route is bound to
  an owned session, and a provider 4xx/5xx/403/451 degrades to a clean
  plain-language error rather than a stack trace or silent hang. Must
  challenge: "auth on the route is enough" / "the client already caps
  size, so the server needn't."
- **Risk #4**: prove the vision route's output contract is a hard
  boundary — nothing the model returns is used beyond the
  strictly-validated timestamp schema, and an adversarial probe set cannot
  make the route emit free text or break the schema. Must challenge: "the
  model only returns timestamps because the prompt asks for timestamps."

Phase 3 is partly feature work: rate limiting and server-side payload caps
do not exist yet, so this phase builds the mitigation and the test
together (see test-plan.md §3). This is a research-first phase — the plan
needs to know the full request path for the vision/recommendation routes,
where a limiter would sit, the current payload caps (if any), the
provider-error branch, and how the timestamp schema is actually enforced
on the model's response before sub-phases can be planned.
