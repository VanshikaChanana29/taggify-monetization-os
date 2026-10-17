import { cn } from "@/lib/utils";

/** Inline success / error message banner. */
export function Notice({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        kind === "error"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
      )}
    >
      {children}
    </p>
  );
}
