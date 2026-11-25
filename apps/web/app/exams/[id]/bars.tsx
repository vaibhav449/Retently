import { cn } from "@/lib/utils";

/**
 * Plain CSS bar charts for the forecast (plan ER5.2; no chart library). Colours are the validated
 * categorical slots 1 and 2 (blue, orange) in their light and dark steps; text stays in text
 * tokens. Each bar has a native tooltip, and each chart a table view for screen readers and for
 * reading exact numbers.
 */
const SERIES = {
  now: "bg-[#2a78d6] dark:bg-[#3987e5]",
  plan: "bg-[#eb6834] dark:bg-[#d95926]",
} as const;

const BUCKET_LABELS = Array.from({ length: 10 }, (_, i) => `${i * 10}–${(i + 1) * 10}%`);

/** A bar's height: its share of the tallest, with a 2 px sliver for any non-zero value. */
function barHeight(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "0px";
  return `max(2px, ${(100 * value) / max}%)`;
}

function Swatch({ series, label }: { series: keyof typeof SERIES; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2.5 rounded-[2px]", SERIES[series])} />
      {label}
    </span>
  );
}

/**
 * The R_exam histogram, as things stand vs with the plan (07 §7): 10 buckets of predicted recall
 * on exam day, two bars each.
 */
export function RecallHistogram({
  now,
  withPlan,
  targetPct,
}: {
  now: readonly number[];
  withPlan: readonly number[];
  targetPct: number;
}) {
  const max = Math.max(1, ...now, ...withPlan);
  return (
    <figure className="flex flex-col gap-3">
      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <Swatch series="now" label="If you study nothing more" />
        <Swatch series="plan" label="With the plan" />
      </div>
      <div aria-hidden className="flex h-36 items-end gap-1 border-b">
        {BUCKET_LABELS.map((label, i) => {
          const a = now[i] ?? 0;
          const b = withPlan[i] ?? 0;
          return (
            <div key={label} className="flex h-full flex-1 items-end justify-center gap-[2px]">
              <div
                title={`${label} recall, if you study nothing more: ${a}`}
                className={cn("w-full max-w-3 rounded-t-[4px]", SERIES.now)}
                style={{ height: barHeight(a, max) }}
              />
              <div
                title={`${label} recall, with the plan: ${b}`}
                className={cn("w-full max-w-3 rounded-t-[4px]", SERIES.plan)}
                style={{ height: barHeight(b, max) }}
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden className="text-muted-foreground flex justify-between text-xs">
        <span>0% recall</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <figcaption className="text-muted-foreground text-xs">
        Questions by predicted recall on exam day. At target means {targetPct}% or more.
      </figcaption>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 font-medium">Predicted recall</th>
              <th className="py-1 font-medium">If you study nothing more</th>
              <th className="py-1 font-medium">With the plan</th>
            </tr>
          </thead>
          <tbody>
            {BUCKET_LABELS.map((label, i) => (
              <tr key={label} className="border-b last:border-0">
                <td className="py-1">{label}</td>
                <td className="py-1 tabular-nums">{now[i] ?? 0}</td>
                <td className="py-1 tabular-nums">{withPlan[i] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** The daily plan (07 §7): reviews on each study day, today first. */
export function DailyPlanBars({
  perDay,
  dayLabels,
}: {
  perDay: readonly number[];
  /** One per day: "Thu 19 Nov". */
  dayLabels: readonly string[];
}) {
  const max = Math.max(1, ...perDay);
  const peak = Math.max(0, ...perDay);
  const total = perDay.reduce((sum, n) => sum + n, 0);
  return (
    <figure className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {total} reviews over {perDay.length} {perDay.length === 1 ? "day" : "days"}; at most {peak}{" "}
        in a day.
      </p>
      <ol aria-label="Reviews per day" className="flex h-28 items-end gap-[2px] border-b">
        {perDay.map((count, i) => (
          <li
            key={dayLabels[i] ?? i}
            className="flex h-full min-w-0 flex-1 items-end justify-center"
            title={`${dayLabels[i] ?? `Day ${i + 1}`}: ${count} reviews`}
          >
            <span className="sr-only">
              {dayLabels[i] ?? `Day ${i + 1}`}: {count} reviews
            </span>
            <span
              aria-hidden
              className={cn("w-full max-w-6 rounded-t-[4px]", SERIES.now)}
              style={{ height: barHeight(count, max) }}
            />
          </li>
        ))}
      </ol>
      <div aria-hidden className="text-muted-foreground flex justify-between text-xs">
        <span>{dayLabels[0] ?? ""}</span>
        {perDay.length > 1 && <span>{dayLabels.at(-1) ?? ""}</span>}
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {perDay.map((count, i) => (
              <tr key={dayLabels[i] ?? i} className="border-b last:border-0">
                <td className="py-1">{dayLabels[i] ?? `Day ${i + 1}`}</td>
                <td className="py-1 tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
