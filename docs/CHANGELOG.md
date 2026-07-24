# Changelog

## v1.0-stable (2026-07)
- Full production pipeline: discovery -> intelligence -> qualification -> outreach
  -> follow-up -> reply detection -> CRM.
- Worker dashboard with CRM reply view + composer.
- Reply detection hardened (IMAP resolved format, content-hash msgids, subject fallback).
- Email hygiene: outreach labeled + archived, replies kept in inbox.
- Daily outreach: 07:00 PHT Mon-Fri; kill-switch abort notifications suppressed.
- Follow-ups suppressed for any lead that replied.
- Repo backed up to GitHub; tagged v1.0-stable.

## Hermes v3 (in progress)
- Hermes severed from Qwen/llama.cpp/local inference.
- Claude Desktop becomes sole reasoning engine via qmd MCP (search-first retrieval).
- Read-only, sandboxed; engineering docs indexed as first-class knowledge.
