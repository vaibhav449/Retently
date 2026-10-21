import type { Scheduler } from "./types";

export interface SchedulerRegistry {
  /** The scheduler for items a user has never reviewed. */
  readonly active: Scheduler;
  /** The scheduler that wrote a stored state. Use this for existing card_state rows, never `active`. */
  get(version: string): Scheduler;
}

/** Maps scheduler versions to implementations (04-scheduler.md §8). */
export function createRegistry(
  schedulers: readonly Scheduler[],
  activeVersion: string,
): SchedulerRegistry {
  const byVersion = new Map<string, Scheduler>();
  for (const scheduler of schedulers) {
    if (byVersion.has(scheduler.version)) {
      throw new Error(`Scheduler version "${scheduler.version}" is registered twice`);
    }
    byVersion.set(scheduler.version, scheduler);
  }

  const get = (version: string): Scheduler => {
    const scheduler = byVersion.get(version);
    if (!scheduler) throw new Error(`Unknown scheduler version "${version}"`);
    return scheduler;
  };

  return { active: get(activeVersion), get };
}
