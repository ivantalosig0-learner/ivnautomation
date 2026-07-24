# Prompt Library

Prompts live in the AI Gateway: `gateway/app/prompts/library.py`.
Endpoints (FastAPI, POST):
- /v1/ai/outreach/initial — initial personalized outreach draft
- /v1/ai/crm/note — CRM note + sentiment + next action from a reply
- (website analysis / follow-up variants)

Model: Qwen3-8B-Q5_K_M via llama.cpp (PRODUCTION ONLY — Hermes does not use this).
Gateway INFERENCE_TIMEOUT_S=300. Node-level httpRequest timeout 120s, retryOnFail.

NOTE: This prompt stack serves production workflows exclusively. Hermes/Claude
reasoning is entirely separate and must never call these endpoints.
