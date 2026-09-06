---
change_id: testing-llm-and-ownership
title: Testing llm and ownership
status: archived
created: 2026-09-03
updated: 2026-09-06
archived_at: 2026-09-06T19:31:22Z
---

## Notes

This is **§3 Phase 2** of the test-plan rollout — _LLM boundary + API-route integration_ (covers Risk #2 OpenRouter response boundary, #5 session-route ownership, #6 stuck , #7 DB errors rendered as "not found"). That's a research-first phase: the plan needs to know which routes exist, which Supabase client each uses, and where the LLM boundary parsing lives.
