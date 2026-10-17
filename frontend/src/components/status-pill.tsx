import { cn } from "@/lib/utils";

export function StatusPill({ active, label }: { active: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-slate-400")} />
      {label ?? (active ? "Active" : "Inactive")}
    </span>
  );
}

/** Small orange-outlined tag, e.g. "SUPER ADMIN". */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase text-orange-600 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-400",
        className,
      )}
    >
      {children}
    </span>
  );
}
