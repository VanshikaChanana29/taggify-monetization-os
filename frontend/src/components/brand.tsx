import { cn } from "@/lib/utils";

/** Placeholder mark. Drop the real logo at public/logo.svg and swap this for an <img>. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("h-9 w-9", className)}>
      <rect width="32" height="32" rx="9" className="fill-foreground" />
      <path d="M8 9h16v4.5h-5.75V24h-4.5V13.5H8z" className="fill-background" />
      <circle cx="23.5" cy="22.5" r="3" fill="hsl(var(--primary))" />
    </svg>
  );
}

export function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <p className="text-lg font-extrabold tracking-wide text-primary">TAGGIFY</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
