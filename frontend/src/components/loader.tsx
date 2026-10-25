import { LogoMark } from "@/components/brand";
import { cn } from "@/lib/utils";

/** The Taggify mark with a ring turning around it. Screen readers hear "Loading". */
export function Spinner({ size = "lg", className }: { size?: "sm" | "lg"; className?: string }) {
  const big = size === "lg";
  return (
    <span role="status" className={cn("relative inline-flex items-center justify-center", big ? "h-16 w-16" : "h-9 w-9", className)}>
      <span className="sr-only">Loading</span>
      {/* track + turning arc; with reduced motion the arc pulses instead of turning */}
      <span className={cn("absolute inset-0 rounded-full border-muted", big ? "border-4" : "border-[3px]")} aria-hidden />
      <span
        className={cn(
          "absolute inset-0 rounded-full border-transparent border-t-primary border-r-primary/40",
          big ? "border-4" : "border-[3px]",
          "motion-safe:animate-spin motion-reduce:animate-pulse",
        )}
        style={{ animationDuration: "0.9s" }}
        aria-hidden
      />
      {big ? <LogoMark className="h-8 w-8" /> : <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
    </span>
  );
}

/** Whole-screen wait: everything behind is blurred until the page has its data. */
export function PageLoader() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/40 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in">
      <div className="rounded-3xl border bg-card/90 p-6 shadow-xl">
        <Spinner />
      </div>
    </div>
  );
}

/** Over one card or table while it refreshes: the old rows stay visible, blurred. */
export function LoadingOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center rounded-[inherit] bg-background/40 pt-16 backdrop-blur-[2px]">
      <Spinner size="sm" />
    </div>
  );
}

/** A small wait inside a section (a tab, a panel). */
export function InlineLoader({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-center py-12", className)}>
      <Spinner size="sm" />
    </div>
  );
}
