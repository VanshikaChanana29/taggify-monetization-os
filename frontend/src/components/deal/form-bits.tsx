"use client";

import { Label } from "@/components/ui/label";

/** Label + control + the error for that field, right under it. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p data-field-error className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export const INVALID = "border-red-400 focus-visible:ring-red-400 dark:border-red-500/60";

export const TEXTAREA =
  "w-full rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Send a server message to the field it mentions; anything else is a form-level error. */
export function fieldFor<K extends string>(message: string, rules: [string, K][], fallback: K): K {
  const text = message.toLowerCase();
  return rules.find(([word]) => text.includes(word))?.[1] ?? fallback;
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}
