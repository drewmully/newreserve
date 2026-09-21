# L02: operational compatibility and strict analytics completion

Compatibility follow-up for the analytics PR stack.
The audit found 13 existing scheduled callers, none with completion evidence.
Making their normal returns fail would break existing polling and operational
job responses without establishing anything about analytics completeness.

`withJobRun` therefore preserves existing normal-return semantics and operational
watermarks. It records `completion_policy=operational`,
`analytics_outcome=unverified`, and `analytics_checkpoint=null`; operational
success is never analytics certification. A skipped or internally partial
legacy callback can still return operational success, as before. This is a
compatibility boundary, not a repair of the existing sources' error handling.

New analytics jobs must opt into `withAnalyticsJobRun`. Only explicit evidence
of complete pagination, writes and schema permits a checkpoint. Missing auth,
partial, schema-drift and unverified runs fail closed. A known incomplete outcome
cannot be overwritten by a later successful completion call. Caller metadata
cannot override the reserved completion-policy/outcome/checkpoint fields.

Both wrappers clear proposed watermarks on thrown failure and fail loudly if
status cannot be persisted. Both currently log to the existing public.job_runs
client; no analytics scheduler uses the strict wrapper yet. Future analytics
orchestration must explicitly bind its status store to the approved environment.
Do not consume a legacy watermark as an analytics checkpoint.

This follow-up belongs in L02 and must propagate through the stack before merge.
A tip-only fix is insufficient if L02 is merged first.
Source-specific evidence, monitoring and alert verification remain release gates.

Tests cover operational compatibility, strict completion, known partial results,
skipped auth, reserved metadata, failed writes and status-persistence errors.
