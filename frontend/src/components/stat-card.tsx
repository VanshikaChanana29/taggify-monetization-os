import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

const TONES = {
  orange: { value: "text-foreground", icon: "bg-orange-50 text-orange-500 dark:bg-orange-500/10" },
  green: { value: "text-emerald-600", icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" },
  amber: { value: "text-orange-600", icon: "bg-amber-50 text-amber-600 dark:bg-amber-500/10" },
  slate: { value: "text-foreground", icon: "bg-muted text-muted-foreground" },
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "orange",
  hint,
  info,
  href,
  onClick,
  active = false,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  /** Small line under the value, e.g. a change vs last month. */
  hint?: React.ReactNode;
  /** What the number means, shown in an (i) tooltip next to the label. */
  info?: React.ReactNode;
  /** Drill down: open the page behind the number… */
  href?: string;
  /** …or apply a filter on the same page. */
  onClick?: () => void;
  /** Highlight when the card's filter is the one applied. */
  active?: boolean;
}) {
  const body = (
    <>
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {label}
          {info && <InfoTip text={info} />}
        </p>
        <p className={cn("mt-3 text-3xl font-bold", TONES[tone].value)}>{value}</p>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex flex-col items-end gap-3">
        <div className={cn("rounded-xl p-3", TONES[tone].icon)}>
          <Icon className="h-6 w-6" />
        </div>
        {(href || onClick) && (
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </>
  );
  const className = cn(
    "group flex items-start justify-between rounded-2xl border bg-card p-6 text-left shadow-sm",
    (href || onClick) && "transition-colors hover:border-primary/40",
    active && "border-primary ring-1 ring-primary",
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
