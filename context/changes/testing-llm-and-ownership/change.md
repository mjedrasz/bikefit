---
change_id: testing-llm-and-ownership
title: Testing llm and ownership
status: impl_reviewed
created: 2026-09-03
updated: 2026-09-04
archived_at: null
---

## Notes

This is **§3 Phase 2** of the test-plan rollout — _LLM boundary + API-route integration_ (covers Risk #2 OpenRouter response boundary, #5 session-route ownership, #6 stuck , #7 DB errors rendered as "not found"). That's a research-first phase: the plan needs to know which routes exist, which Supabase client each uses, and where the LLM boundary parsing lives.
