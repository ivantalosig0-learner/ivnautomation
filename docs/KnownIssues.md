# Known Issues & Hard-won Lessons

1. Chain triggers MUST be fire-and-forget (waitForSubWorkflow:false) or parent
   timeouts cascade-cancel children (the July 20 red-health incident).
2. Editing a workflow can silently disconnect its schedule trigger from the first
   node — trigger fires, empty runData, engine does nothing. Verify after edits.
3. saveDataSuccessExecution:'none' makes healthy engines look stalled on the dashboard.
4. IMAP node format MUST be 'resolved' (not 'simple') or replies arrive with no sender/msgid.
5. Reply fallback message-ids must hash full content; truncating collapsed a whole
   thread to one id and ON CONFLICT DO NOTHING silently dropped messages.
6. Enrichment HTTP nodes need onError:continueRegularOutput or one 404 fails the batch.
7. Error Trigger payloads vary: node errors use execution.error.lastNodeExecuted;
   trigger errors use trigger.error.message (no execution key).
8. VPS is CPU/RAM constrained (4 cores, 15GB, llama holds 12GB, 0 swap). Do not run
   heavy CPU jobs alongside production inference.
9. Dashboard page builder is one 74KB Code node — extend via the Inject-node pattern,
   never hand-edit; syntax-check served inline JS after changes.
10. Daily Outreach abort notifications are suppressed when caused by the kill switch.
