# Workflow Inventory (n8n)

| Workflow | ID | Trigger | Purpose |
|---|---|---|---|
| Opportunity Discovery Engine | YLP4NPutkGPwlhkA | daily 07:30 PHT | Find candidate businesses -> leads.candidates (discovered) |
| Lead Intelligence Engine | xAQVVw5pVJE2uLR3 | every 30 min | Crawl sites, extract emails/socials/profile -> enriched. timeout 3000s |
| Lead Qualification Engine | mwHCwOBO9RuyDNGs | hourly | qual_v1 scoring, stage transitions, shortlist_rank. timeout 900s |
| Personalized Outreach Engine | HJB5HhkSbi1Qozrr | every 30 min | Qwen renews 15 drafts/run, hot-first. Draft-only, never sends |
| Daily Automated Outreach Engine | 3bNNqQehDJdK8onH | 07:00 PHT Mon-Fri | Sends up to cap/day from shortlist; kill-switch + quiet guard |
| Outreach Follow-up Engine | Lib5FMwNDcgaX3qv | weekdays 09:30 | Follow-ups; skips anyone who replied |
| Reply Detection Engine | TgMGAgTDGeD7gWxc | IMAP | Match replies (msgid/refs/email/subject) -> CRM replied |
| Lead Gen Error Handler | 39Vcvm1lkmQZXFpS | error trigger | Notifications + email alerts; suppresses IMAP reconnect noise |
| Worker Dashboard API | 1pYwAsuAzLw36IKK | webhook | Auth + leads/draft/send/crm/replies/notifications/stats |
| Worker Lead Dashboard | pC85wHkQPzwh8dhd | webhook | Team dashboard SPA (Lead Board / CRM / Ops) |
| Outreach Control API | KkrBNoYYy98VGKID | webhook | Kill switch, cap, threshold settings |
| Opportunity Conversion Engine / API | ysS4b8G4GJ5v9t9v / ajAQAUHdKSDDbTxE | — | Conversion scoring |
| Website Quote Intake | nbC6TJNH2kogzvav | webhook | Website quote form -> notify |

## Chain design
Discovery->Intelligence->Qualification->Outreach are chained with
waitForSubWorkflow:false (fire-and-forget) so a parent timeout never cascade-cancels
a child. Each engine reads its own work from the DB.
