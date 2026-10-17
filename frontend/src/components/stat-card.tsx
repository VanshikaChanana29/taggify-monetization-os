import type { LucideIcon } from "lucide-react";

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
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="flex items-start justify-between rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("mt-3 text-3xl font-bold", TONES[tone].value)}>{value}</p>
      </div>
      <div className={cn("rounded-xl p-3", TONES[tone].icon)}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  );
}
