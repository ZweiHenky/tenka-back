export type BackgroundJob = 'media-deletion' | 'media-intents' | 'tag-cleanup' | 'notification-outbox'
  | 'billing-webhook' | 'billing-webhook-retention' | 'billing-reconciliation' | 'billing-checkout'
  | 'billing-grace-expiry' | 'billing-migration-expiry';

type Signal = (dueAt?: Date) => void;

const listeners = new Map<BackgroundJob, Signal>();

export function registerJobSignal(job: BackgroundJob, signal: Signal): () => void {
  listeners.set(job, signal);
  return () => {
    if (listeners.get(job) === signal) listeners.delete(job);
  };
}

export function signalBackgroundJob(job: BackgroundJob, dueAt?: Date): void {
  listeners.get(job)?.(dueAt);
}
