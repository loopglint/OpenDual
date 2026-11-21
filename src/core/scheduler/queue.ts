import type { TaskPriority } from '../messaging/protocol';
import { EngineError } from '../engines/types';

interface QueuedTask<T> {
  id: string;
  engineKey: string;
  priority: number;
  enqueuedAt: number;
  signal: AbortSignal;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

interface EngineLimiterState {
  active: number;
  recentTimestamps: number[];
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

export class TranslationScheduler {
  private queue: Array<QueuedTask<unknown>> = [];
  private engineStates = new Map<string, EngineLimiterState>();
  private engineLimits = new Map<string, { concurrency: number; rpmLimit?: number }>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  configureEngine(engineKey: string, concurrency: number, rpmLimit?: number): void {
    this.engineLimits.set(engineKey, {
      concurrency: Math.max(1, concurrency),
      rpmLimit: rpmLimit && rpmLimit > 0 ? rpmLimit : undefined,
    });
  }

  enqueue<T>(opts: {
    id: string;
    engineKey: string;
    priority: TaskPriority;
    signal: AbortSignal;
    run: () => Promise<T>;
  }): Promise<T> {
    if (opts.signal.aborted) {
      return Promise.reject(new EngineError('任务已取消', 'ABORTED', { retryable: false }));
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: opts.id,
        engineKey: opts.engineKey,
        priority: PRIORITY_WEIGHT[opts.priority],
        enqueuedAt: Date.now(),
        signal: opts.signal,
        run: opts.run,
        resolve,
        reject,
      };

      const onAbort = () => {
        const idx = this.queue.indexOf(task as QueuedTask<unknown>);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new EngineError('任务已在队列中取消', 'ABORTED', { retryable: false }));
        }
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });

      this.queue.push(task as QueuedTask<unknown>);
      // Stable priority sort: higher priority first, FIFO within same priority
      this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
      this.drain();
    });
  }

  private getState(engineKey: string): EngineLimiterState {
    let st = this.engineStates.get(engineKey);
    if (!st) {
      st = { active: 0, recentTimestamps: [] };
      this.engineStates.set(engineKey, st);
    }
    return st;
  }

  private canStart(engineKey: string, now: number): { allowed: boolean; waitMs: number } {
    const limits = this.engineLimits.get(engineKey) ?? { concurrency: 3 };
    const state = this.getState(engineKey);
    if (state.active >= limits.concurrency) {
      return { allowed: false, waitMs: 0 };
    }
    if (limits.rpmLimit) {
      const windowStart = now - 60_000;
      while (state.recentTimestamps.length > 0 && (state.recentTimestamps[0] ?? 0) < windowStart) {
        state.recentTimestamps.shift();
      }
      if (state.recentTimestamps.length >= limits.rpmLimit) {
        const oldest = state.recentTimestamps[0] ?? now;
        const waitMs = Math.max(50, oldest + 60_000 - now);
        return { allowed: false, waitMs };
      }
    }
    return { allowed: true, waitMs: 0 };
  }

  private drain(): void {
    const now = Date.now();
    let minWaitMs = Infinity;

    for (let i = 0; i < this.queue.length; ) {
      const task = this.queue[i];
      if (!task) {
        this.queue.splice(i, 1);
        continue;
      }
      if (task.signal.aborted) {
        this.queue.splice(i, 1);
        task.reject(new EngineError('任务已取消', 'ABORTED', { retryable: false }));
        continue;
      }

      const check = this.canStart(task.engineKey, now);
      if (!check.allowed) {
        if (check.waitMs > 0 && check.waitMs < minWaitMs) {
          minWaitMs = check.waitMs;
        }
        i++;
        continue;
      }

      this.queue.splice(i, 1);
      const state = this.getState(task.engineKey);
      state.active++;
      state.recentTimestamps.push(now);

      task
        .run()
        .then((res) => task.resolve(res))
        .catch((err) => task.reject(err))
        .finally(() => {
          state.active = Math.max(0, state.active - 1);
          this.drain();
        });
    }

    if (minWaitMs < Infinity && !this.drainTimer) {
      this.drainTimer = setTimeout(() => {
        this.drainTimer = null;
        this.drain();
      }, minWaitMs);
    }
  }
}
