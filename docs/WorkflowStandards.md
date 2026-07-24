# Workflow Standards (n8n)

- Every engine sets error workflow 39Vcvm1lkmQZXFpS (Lead Gen Error Handler).
- Schedule triggers must be connected to their first real node; verify after edits.
- Chain-triggers between engines use executeWorkflow with waitForSubWorkflow:false.
- saveDataSuccessExecution:'all' on engines the dashboard health panel watches.
- HTTP fetch nodes that may 404: onError:continueRegularOutput.
- Sends are idempotent: outreach_runs unique per day; drafts flip to sent with message_id.
- Postgres nodes use parameterized queryReplacement, never string interpolation.
- Timezones: PHT for business logic; workflow tz Australia/Adelaide.
