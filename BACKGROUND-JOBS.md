# Background jobs

The API keeps PostgreSQL as the source of truth for all four job schedules. Enqueue paths signal the in-process due-time processor only after their transaction commits. Signals are hints: startup recovery and the maintenance cron query the durable queues, so a crash or missed signal does not lose work.

Each processor is single-flight, claims rows with `FOR UPDATE SKIP LOCKED`, preserves leases and retry backoff, and schedules its next timer from the database `nextDueAt`. There is no fixed polling interval.

## Railway

The API service runs `pnpm start` as before. Add a separate Railway Cron service using the same image and environment:

```text
Schedule: */30 * * * *
Command: pnpm maintenance
```

The image must be built first (`pnpm build`), which compiles `src/maintenance.ts` to `dist/maintenance.js`. The cron is a recovery safety net and can run concurrently with the API because queue claims use leases and skip locked rows.

Signals are process-local by design. The API does not hold a PostgreSQL `LISTEN` connection open, because that would prevent Neon from suspending while the application is idle. With more than one API replica, the replica that commits a job handles it immediately; a crash between commit and signal is recovered at startup or by the cron, with a maximum cron delay of 30 minutes.

Shutdown marks the API unready, drains HTTP requests so no enqueue can race shutdown, then stops and drains processors before disconnecting PostgreSQL.
