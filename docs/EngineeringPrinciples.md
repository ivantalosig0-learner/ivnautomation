# Engineering Principles

- Business value, simplicity, modularity, replaceability, maintainability,
  production readiness, security, scalability.
- Repository > Conversation > Assumptions. Never invent architecture that
  conflicts with repo docs.
- Every component owns one responsibility; design for independent replacement.
- Production evidence over structural claims: verify via execution_entity status,
  DB queries, live endpoint checks — not "it should work."
- No placeholder code, no TODOs unless blocked. Production-quality only.
- Never introduce complexity for hypothetical futures. Solve today's problem
  without preventing tomorrow's growth.
