import type { Mix } from "../lib/outlook";

const DAY = 86_400_000;

/**
 * Daily due counts as columns, today first. Every column is labelled with its
 * count and weekday initial (Mondays stand out, marking the weeks), so the
 * chart can be read without a y-axis; the full date is in the tooltip.
 */
export function ForecastBars({ forecast, now }: { forecast: number[]; now: Date }) {
  const max = Math.max(1, ...forecast);
  const total = forecast.reduce((a, n) => a + n, 0);
  return (
    <figure>
      <div
        className="grid h-24 items-end gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`${total} reviews due over the next ${forecast.length} days`}
      >
        {forecast.map((n, i) => (
          <div key={i} className="flex h-full flex-col justify-end" title={`${dayLabel(now, i)}: ${n} due`}>
            <span className={`mb-1 text-center text-2xs leading-none tabular-nums ${n ? "text-ink-2" : "text-faint"}`}>
              {n}
            </span>
            <div
              className={`rounded-t-[2px] ${i === 0 ? "bg-accent-fill" : "bg-accent-rule/45"}`}
              style={{ height: n ? `${Math.max(4, (n / max) * 100)}%` : "1px" }}
            />
          </div>
        ))}
      </div>
      <div
        className="mt-1.5 grid gap-[3px] border-t border-hairline pt-1.5 text-center text-2xs leading-none tabular-nums text-muted"
        style={{ gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {forecast.map((_, i) => {
          const d = new Date(now.getTime() + i * DAY);
          return (
            <span key={i} className={i === 0 ? "font-semibold text-accent" : d.getDay() === 1 ? "font-semibold text-ink" : ""}>
              {d.toLocaleDateString(undefined, { weekday: "narrow" })}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

const STAGES: { key: keyof Mix; label: string; tone: string }[] = [
  { key: "new", label: "New", tone: "bg-accent-rule/25" },
  { key: "learning", label: "Learning", tone: "bg-accent-rule/50" },
  { key: "young", label: "Young", tone: "bg-accent-rule/80" },
  { key: "mature", label: "Mature", tone: "bg-accent-fill" },
];

/**
 * New → mature as one stacked bar, darkest where cards are best known. With
 * `color` (a deck's hue) the steps are tints of it; otherwise the accent.
 */
export function MixBar({
  mix,
  total,
  color,
  className = "h-2",
}: {
  mix: Mix;
  total: number;
  color?: string;
  className?: string;
}) {
  const tint = [30, 55, 78, 100];
  return (
    <div className={`flex gap-px overflow-hidden rounded-full bg-sunken ${className}`} aria-hidden>
      {total > 0 &&
        STAGES.map(({ key, tone }, i) =>
          mix[key] > 0 ? (
            <div
              key={key}
              className={color ? undefined : tone}
              style={{
                width: `${(100 * mix[key]) / total}%`,
                backgroundColor: color ? `color-mix(in oklab, ${color} ${tint[i]}%, var(--paper))` : undefined,
              }}
            />
          ) : null
        )}
    </div>
  );
}

/** Where the collection stands, as one stacked bar and a legend with counts. */
export function CollectionMix({ mix, total }: { mix: Mix; total: number }) {
  return (
    <div>
      <MixBar mix={mix} total={total} />
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {STAGES.map(({ key, label, tone }) => (
          <div key={key} className="flex items-center gap-2 text-13">
            <span className={`h-2 w-2 shrink-0 rounded-[2px] ${tone}`} aria-hidden />
            <dt className="text-muted">{label}</dt>
            <dd className="ml-auto font-medium tabular-nums text-ink">{mix[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-snug text-muted">Mature cards have intervals of 21 days or more.</p>
    </div>
  );
}

function dayLabel(now: Date, offset: number): string {
  if (offset === 0) return "Today (incl. overdue)";
  if (offset === 1) return "Tomorrow";
  return new Date(now.getTime() + offset * DAY).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
