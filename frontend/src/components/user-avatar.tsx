import { cn } from "@/lib/utils";

const COLORS = [
  "bg-indigo-500",
  "bg-red-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-teal-500",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function colorFor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Initials avatar with a stable colour per person. */
export function UserAvatar({
  name,
  seed,
  square = false,
  className,
}: {
  name: string;
  seed?: string;
  square?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center text-sm font-semibold text-white",
        square ? "rounded-xl bg-red-600" : cn("rounded-full", colorFor(seed ?? name)),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
