"use client";

import { cn } from "@/lib/utils";

export type TabItem<K extends string> = {
  key: K;
  label: string;
  /** Small number after the label, e.g. how many episodes. */
  count?: number;
  /** Red dot when something in the tab needs attention. */
  alert?: boolean;
};

/** A row of tabs with an underline on the active one. */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
            value === t.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                value === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {t.count}
            </span>
          )}
          {t.alert && <span aria-label="needs attention" className="h-2 w-2 rounded-full bg-red-500" />}
        </button>
      ))}
    </div>
  );
}
