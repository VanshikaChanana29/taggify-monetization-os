import type { LucideIcon } from "lucide-react";
import Link from "next/link";

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
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  /** Small line under the value, e.g. a change vs last month. */
  hint?: React.ReactNode;
  /** Makes the whole card a link to the page behind the number. */
  href?: string;
}) {
  const body = (
    <>
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("mt-3 text-3xl font-bold", TONES[tone].value)}>{value}</p>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className={cn("rounded-xl p-3", TONES[tone].icon)}>
        <Icon className="h-6 w-6" />
      </div>
    </>
  );
  const className = "flex items-start justify-between rounded-2xl border bg-card p-6 shadow-sm";
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
