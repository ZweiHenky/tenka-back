# Background jobs

The API keeps PostgreSQL as the source of truth for all job schedules. Enqueue paths signal the in-process due-time processor only after their transaction commits. Signals are hints: startup recovery and the maintenance cron query the durable queues, so a crash or missed signal does not lose work. When RevenueCat billing is enabled, processors handle the webhook inbox, payload retention, and durable checkout verification. A separately gated processor handles sparse periodic reconciliation only when `BILLING_PERIODIC_RECONCILIATION_ENABLED=true`. `billing-grace-expiry` is always registered because a previously materialized deadline must close even after provider or materialization flags are disabled; it performs no provider call and revalidates under the canonical billing-account lock.

Each processor is single-flight, claims rows with `FOR UPDATE SKIP LOCKED`, preserves leases and retry backoff, and schedules its next timer from the database `nextDueAt`. There is no fixed polling interval.

## Railway

The API service runs `pnpm start` as before. Add a separate Railway Cron service using the same image and environment:

```text
Schedule: 0 */2 * * *
Command: pnpm maintenance
```

The image must be built first (`pnpm build`), which compiles `src/maintenance.ts` to `dist/maintenance.js`. The cron is a recovery safety net and can run concurrently with the API because queue claims use leases and skip locked rows.

Periodic RevenueCat reconciliation is disabled by default and never scans ordinary free accounts. Its queue contains only accounts with commercial evidence or an explicit commercial signal. Maintenance processes at most ten batches of this provider job per run, so the two-hour safety cron cannot turn a backlog into an unbounded provider-call burst.

Checkout attempts schedule `nextVerificationAt` before the store opens. The worker claims one attempt at a time, reconciles canonical RevenueCat evidence, and records attempts/errors in `BillingVerification`. SDK outcomes never grant access. Confirmed canonical materialization closes the attempt; a reported cancellation or stale `PREPARED` attempt releases its initial-purchase selection only after successful reconciliation proves that no matching active or pending purchase exists. Product-change attempts instead advance their linked `BillingChangeOperation`: absence after a canceled/stale first step ends it as `CANCELED`, while absence after the final deferred step leaves `SECOND_STEP_PENDING` so the user may confirm that step again without repeating the first charge.

Signals are process-local by design. The API does not hold a PostgreSQL `LISTEN` connection open, because that would prevent Neon from suspending while the application is idle. With more than one API replica, the replica that commits a job handles it immediately; a crash between commit and signal is recovered at startup or by the cron, with a maximum cron delay of two hours.

Shutdown marks the API unready, drains HTTP requests so no enqueue can race shutdown, then stops and drains processors before disconnecting PostgreSQL.
