export const ALERT_WORKER_BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const;

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface RetryDeferral {
  due: boolean;
  delaySeconds: number;
}

export function nextRetryDate(attempts: number, now: Date = new Date()): Date {
  const backoffIndex = Math.max(0, Math.min(attempts - 1, ALERT_WORKER_BACKOFF_MINUTES.length - 1));
  const minutes = ALERT_WORKER_BACKOFF_MINUTES[backoffIndex];
  return new Date(now.getTime() + minutes * MILLISECONDS_PER_MINUTE);
}

export function retryDeferral(nextRetryAt: unknown, now: Date = new Date()): RetryDeferral {
  if (typeof nextRetryAt !== "string" || nextRetryAt.trim() === "") return { due: true, delaySeconds: 0 };

  const retryTime = Date.parse(nextRetryAt);
  if (!Number.isFinite(retryTime)) return { due: true, delaySeconds: 0 };

  const delaySeconds = Math.ceil((retryTime - now.getTime()) / MILLISECONDS_PER_SECOND);
  if (delaySeconds <= 0) return { due: true, delaySeconds: 0 };

  return { due: false, delaySeconds };
}
