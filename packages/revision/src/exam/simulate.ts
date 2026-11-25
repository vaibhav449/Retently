import type { CardState, Grade, Scheduler, SchedulerRegistry } from "@repo/scheduler";

const HOUR_MS = 3_600_000;

/** One in-scope item the forecast plans for (07-exam-mode.md §5.1). */
export interface SimItem {
  itemId: string;
  /** The scheduler that wrote `state`; null for an item never reviewed, which uses registry.active. */
  schedulerVersion: string | null;
  /** null for an item never reviewed. */
  state: CardState | null;
  /** The effective due date, min(due_at, misconception_until); null for an item never reviewed. */
  dueAt: Date | null;
}

export interface SimOptions {
  now: Date;
  /**
   * The local day boundaries from today's start to exam_at: `daysLeft + 1` instants
   * (localDayStarts()). Study day d runs from dayStarts[d] to dayStarts[d + 1]; the last one is
   * the exam's start, when R_exam is read. One boundary = the exam is today: no study day.
   */
  dayStarts: readonly Date[];
  /** Reviews a day, at most. */
  capacity: number;
  registry: SchedulerRegistry;
  /** Every simulated review gets this grade (Good, 07 §5.1). */
  grade: Grade;
  /** A study day's reviews happen this many hours after it starts; today's no earlier than now. */
  middayHours: number;
  /**
   * Also due: a seen item whose recall at the day's review time is below this, the exam-due rule
   * of the queue (07 §4.2). Pass an exam target above the scheduler's own 0.9; omit it otherwise.
   */
  examDueBelow?: number;
}

export interface SimResult {
  /** Reviews on each study day. */
  perDay: number[];
  /** R_exam of each item, in the order of the input; 0 for an item still never reviewed. */
  rExam: number[];
}

export interface CapacitySearch {
  /** The fewest reviews a day that bring every item to the target; null when even N cannot. */
  capacity: number | null;
  /** The simulation at `capacity`, or at N (the best there is) when `capacity` is null. */
  result: SimResult;
}

/** Simulations of one item set over one stretch of days, at any capacity. */
export interface Simulator {
  run(capacity: number): SimResult;
  requiredCapacity(target: number): CapacitySearch;
}

/**
 * One state an item can reach in the simulation: its stored state (a root), or the state after
 * reviews on a particular set of study days (a child per review day). Runs at different
 * capacities walk the same tree, so each review and each recall is computed once per search.
 */
interface StateNode {
  /** null: never reviewed. */
  state: CardState | null;
  dueMs: number;
  /** The state after a review on study day d, by d. */
  next: Map<number, StateNode> | null;
  /** Recall at study day d's review time, by d. */
  recall: Map<number, number> | null;
  /** Recall at the exam; NaN until asked. */
  rExam: number;
  /** The first study day whose review-time recall is below examDueBelow; -1 until asked. */
  examDueDay: number;
}

/**
 * The forecast's simulation (07-exam-mode.md §5.1, ER4.1), prepared once for `items` and every
 * capacity: for each study day, at midday, review up to `capacity` items, the due ones first
 * (lowest recall first when they do not all fit, ties by item id) and then never-reviewed ones in
 * their given order, each graded `grade` through its own scheduler (a new item through
 * registry.active); then read every item's R_exam at the exam. With `examDueBelow`, an item is also
 * due once its recall falls below it, as the queue's exam-due pool makes it. Pure and deterministic: `items`
 * and their states are only read. Runs share every review and recall already computed (a tree of
 * states per item, keyed by review day), which is what makes the capacity search affordable.
 */
export function createSimulator(
  items: readonly SimItem[],
  o: Omit<SimOptions, "capacity">,
): Simulator {
  const n = items.length;
  const lastStart = o.dayStarts.at(-1);
  if (lastStart === undefined) throw new RangeError("simulatePlan: no exam date");
  const examAt: Date = lastStart;
  const days = o.dayStarts.length - 1;
  const schedulers = items.map((item) =>
    item.schedulerVersion === null ? o.registry.active : o.registry.get(item.schedulerVersion),
  );
  const roots: StateNode[] = items.map((item) => ({
    state: item.state,
    dueMs: item.state === null ? Number.NaN : (item.dueAt?.getTime() ?? Number.NaN),
    next: null,
    recall: null,
    rExam: Number.NaN,
    examDueDay: -1,
  }));
  const fresh = items.flatMap((item, index) => (item.state === null ? [index] : []));
  // Ties in recall go to the smaller item id: rank the ids once.
  const idRank = new Int32Array(n);
  [...items.keys()]
    .sort((a, b) => {
      const ia = (items[a] as SimItem).itemId;
      const ib = (items[b] as SimItem).itemId;
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    })
    .forEach((index, rank) => {
      idRank[index] = rank;
    });
  const reviewAt: Date[] = [];
  const dayEnd: number[] = [];
  for (let day = 0; day < days; day += 1) {
    const midday = (o.dayStarts[day] as Date).getTime() + o.middayHours * HOUR_MS;
    reviewAt.push(new Date(day === 0 ? Math.max(o.now.getTime(), midday) : midday));
    dayEnd.push((o.dayStarts[day + 1] as Date).getTime());
  }

  const recallAt = (node: StateNode, i: number, day: number): number => {
    node.recall ??= new Map();
    let recall = node.recall.get(day);
    if (recall === undefined) {
      recall = (schedulers[i] as Scheduler).retrievability(
        node.state as CardState,
        reviewAt[day] as Date,
      );
      node.recall.set(day, recall);
    }
    return recall;
  };
  const reviewed = (node: StateNode, i: number, day: number): StateNode => {
    node.next ??= new Map();
    let child = node.next.get(day);
    if (child === undefined) {
      const scheduler = schedulers[i] as Scheduler;
      const state = scheduler.next(
        node.state ?? scheduler.initial(),
        o.grade,
        reviewAt[day] as Date,
      );
      child = {
        state,
        dueMs: Date.parse(state.due_at ?? ""),
        next: null,
        recall: null,
        rExam: Number.NaN,
        examDueDay: -1,
      };
      node.next.set(day, child);
    }
    return child;
  };

  const below = o.examDueBelow;
  /**
   * The first study day on which the node's recall at review time is below `below`, or `days`
   * for none. Recall never rises without a review, so a binary search over the days finds it with
   * ~log₂(days) recalls, once per node.
   */
  const examDueDay = (node: StateNode, i: number, threshold: number): number => {
    if (node.examDueDay >= 0) return node.examDueDay;
    let lo = 0;
    let hi = days;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (recallAt(node, i, mid) < threshold) hi = mid;
      else lo = mid + 1;
    }
    node.examDueDay = lo;
    return lo;
  };

  function run(capacityIn: number): SimResult {
    const capacity = Math.max(0, Math.floor(capacityIn));
    const nodes = [...roots];
    const recall = new Float64Array(n);
    const perDay: number[] = [];
    let nextFresh = 0;

    for (let day = 0; day < days; day += 1) {
      const end = dayEnd[day] as number;
      // Due before the day ends; each item at most once a day, since the list is made first.
      const due: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const node = nodes[i] as StateNode;
        if (node.state === null) continue;
        if (node.dueMs < end || (below !== undefined && day >= examDueDay(node, i, below))) {
          due.push(i);
        }
      }
      // Most at risk first, but only when not every due item fits: otherwise the order is moot.
      if (due.length > capacity) {
        if (capacity > 0) {
          for (const i of due) recall[i] = recallAt(nodes[i] as StateNode, i, day);
          // Only which items are chosen matters, not their order: they are all reviewed today.
          selectSmallest(due, capacity, (a, b) => {
            const byRecall = (recall[a] as number) - (recall[b] as number);
            return byRecall !== 0 ? byRecall < 0 : (idRank[a] as number) < (idRank[b] as number);
          });
        }
        due.length = capacity;
      }
      // Reviews before new items (07 §5.1).
      while (due.length < capacity && nextFresh < fresh.length) {
        due.push(fresh[nextFresh] as number);
        nextFresh += 1;
      }
      for (const i of due) nodes[i] = reviewed(nodes[i] as StateNode, i, day);
      perDay.push(due.length);
    }

    const rExam = nodes.map((node, i) => {
      if (node.state === null) return 0;
      if (Number.isNaN(node.rExam)) {
        node.rExam = (schedulers[i] as Scheduler).retrievability(node.state, examAt);
      }
      return node.rExam;
    });
    return { perDay, rExam };
  }

  /**
   * required_per_day (07 §5.2, ER4.2): the smallest capacity C ∈ [0, N] whose run brings all N
   * items to `target`. Searched upwards by doubling from ⌈new items / study days⌉ (each new item
   * needs a review, so fewer cannot do), then by bisection, then checked downwards so that C
   * passes and C − 1 fails even where more capacity is not monotonically better. Null when even
   * C = N fails (infeasible). The doubling spares the costly C = N run whenever a plan exists.
   */
  function requiredCapacity(target: number): CapacitySearch {
    const runs = new Map<number, SimResult>();
    const at = (capacity: number): SimResult => {
      let result = runs.get(capacity);
      if (result === undefined) {
        result = run(capacity);
        runs.set(capacity, result);
      }
      return result;
    };
    const passes = (capacity: number) => atTarget(at(capacity).rExam, target) === n;

    if (passes(0)) return { capacity: 0, result: at(0) };
    if (days === 0 || n === 0) return { capacity: null, result: at(n) };
    let failing = 0;
    let passing = Math.min(n, Math.max(1, Math.ceil(fresh.length / days)));
    while (!passes(passing)) {
      if (passing === n) return { capacity: null, result: at(n) };
      failing = passing;
      passing = Math.min(n, passing * 2);
    }
    // passes(passing), and failing fails: bisect between them.
    while (passing - failing > 1) {
      const mid = failing + Math.floor((passing - failing) / 2);
      if (passes(mid)) passing = mid;
      else failing = mid;
    }
    let capacity = passing;
    while (capacity > 0 && passes(capacity - 1)) capacity -= 1;
    return { capacity, result: at(capacity) };
  }

  return { run, requiredCapacity };
}

/**
 * Rearranges `values` so that its first `k` entries are its `k` smallest under `less` (a strict
 * total order), in no particular order: a quickselect with a median-of-three pivot, O(n) on
 * average. The chosen set is unique, so the result does not depend on the pivots.
 */
function selectSmallest(values: number[], k: number, less: (a: number, b: number) => boolean) {
  const swap = (i: number, j: number) => {
    const held = values[i] as number;
    values[i] = values[j] as number;
    values[j] = held;
  };
  let lo = 0;
  let hi = values.length - 1;
  while (hi > lo) {
    const mid = lo + ((hi - lo) >> 1);
    // Median of three into `hi`, as the pivot.
    if (less(values[mid] as number, values[lo] as number)) swap(mid, lo);
    if (less(values[hi] as number, values[lo] as number)) swap(hi, lo);
    if (less(values[mid] as number, values[hi] as number)) swap(mid, hi);
    const pivot = values[hi] as number;
    let store = lo;
    for (let i = lo; i < hi; i += 1) {
      if (less(values[i] as number, pivot)) {
        swap(i, store);
        store += 1;
      }
    }
    swap(store, hi);
    // values[store] is in its sorted place; everything before it is smaller.
    if (store === k) return;
    if (store < k) lo = store + 1;
    else hi = store - 1;
  }
}

/** One run of the simulation at `o.capacity` (createSimulator()). Pure. */
export function simulatePlan(items: readonly SimItem[], o: SimOptions): SimResult {
  return createSimulator(items, o).run(o.capacity);
}

/** required_per_day for `items` (createSimulator().requiredCapacity()). Pure. */
export function requiredCapacity(
  items: readonly SimItem[],
  o: Omit<SimOptions, "capacity">,
  target: number,
): CapacitySearch {
  return createSimulator(items, o).requiredCapacity(target);
}

/** How many of `rExam` are at least `target`. */
export function atTarget(rExam: readonly number[], target: number): number {
  let count = 0;
  for (const recall of rExam) if (recall >= target) count += 1;
  return count;
}
