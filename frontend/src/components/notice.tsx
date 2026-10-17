import { cn } from "@/lib/utils";

const KINDS = {
  error: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
} as const;

/** Inline message banner. */
export function Notice({ kind, children }: { kind: keyof typeof KINDS; children: React.ReactNode }) {
  return <p className={cn("rounded-xl border px-4 py-3 text-sm", KINDS[kind])}>{children}</p>;
}
