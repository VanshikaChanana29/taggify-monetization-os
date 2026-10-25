"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { SearchInput } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/** One filter in the side panel. The first option is the "everything" choice (value "").
 * `group` puts filters under a small heading in the panel. */
export type FilterField = { key: string; label: string; options: [string, string][]; group?: string };

// Up to this many choices show as one-click chips; longer lists stay a dropdown.
const CHIP_LIMIT = 5;

// Two short chip filters (e.g. Platform and Status) share a row.
const half = (f: FilterField) => f.options.length <= 3 && f.options.reduce((n, [, text]) => n + text.length, 0) <= 20;

/**
 * The list toolbar used on every list page: search (and any quick control, like a period) in
 * one row, every other filter in a side panel behind a "Filters" button, and the filters in use
 * shown as removable chips.
 */
export function ListFilters({
  search,
  onSearch,
  placeholder = "Search…",
  fields = [],
  values = {},
  onChange,
  onClear,
  total,
  noun = "results",
  children,
}: {
  /** Leave out for lists without a search box. */
  search?: string;
  onSearch?: (value: string) => void;
  placeholder?: string;
  fields?: FilterField[];
  values?: Record<string, string>;
  onChange?: (key: string, value: string) => void;
  /** Clears search and every filter. */
  onClear: () => void;
  /** How many rows match, for the panel's button. */
  total?: number | null;
  noun?: string;
  /** Quick controls shown next to the search (e.g. a period). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chips = fields.filter((f) => values[f.key]).map((f) => ({ ...f, text: f.options.find(([v]) => v === values[f.key])?.[1] ?? values[f.key] }));
  const showClear = chips.length > 0 || Boolean(search);
  // Keep the order filters were given in; a filter without a group joins the one before it.
  const groups: [string, FilterField[]][] = [];
  for (const f of fields) {
    const name = f.group ?? groups.at(-1)?.[0] ?? "";
    if (groups.at(-1)?.[0] === name) groups.at(-1)![1].push(f);
    else groups.push([name, [f]]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {onSearch ? (
          <div className="min-w-56 flex-1">
            <SearchInput value={search ?? ""} onChange={onSearch} placeholder={placeholder} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {children}
        {fields.length > 0 && (
          <Button variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <SlidersHorizontal />
            Filters
            {chips.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">{chips.length}</span>
            )}
          </Button>
        )}
      </div>

      {showClear && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-3 pr-1.5 text-sm shadow-sm">
              <span className="text-muted-foreground">{c.label}:</span>
              <span className="font-medium">{c.text}</span>
              <button
                type="button"
                aria-label={`Remove ${c.label} filter`}
                onClick={() => onChange?.(c.key, "")}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={onClear}>
            Clear all
          </button>
        </div>
      )}

      {fields.length > 0 && (
        <Dialog open={open} onClose={() => setOpen(false)} side title="Filters" description="Changes apply straight away.">
          <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-5">
            {groups.map(([group, list]) => (
              <section key={group || "all"} className="grid grid-cols-2 gap-x-4 gap-y-3">
                {group && <p className="col-span-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>}
                {list.map((f) => {
                  const value = values[f.key] ?? "";
                  return (
                    <div key={f.key} className={cn("space-y-1.5", half(f) ? "col-span-1" : "col-span-2")}>
                      <Label htmlFor={`f-${f.key}`} className="flex items-center gap-2">
                        {f.label}
                        {value && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="in use" />}
                      </Label>
                      {f.options.length <= CHIP_LIMIT ? (
                        <div id={`f-${f.key}`} role="radiogroup" aria-label={f.label} className="flex flex-wrap gap-1.5">
                          {f.options.map(([v, text]) => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={value === v}
                              onClick={() => onChange?.(f.key, v)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[13px] transition-colors",
                                value === v
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : "bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
                              )}
                            >
                              {text}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <NativeSelect id={`f-${f.key}`} value={value} onChange={(e) => onChange?.(f.key, e.target.value)}>
                          {f.options.map(([v, text]) => (
                            <option key={v} value={v}>
                              {text}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="-mx-6 -mb-6 flex shrink-0 items-center justify-between gap-3 border-t bg-card px-6 py-4">
            <button
              type="button"
              disabled={chips.length === 0}
              className="text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => fields.forEach((f) => onChange?.(f.key, ""))}
            >
              Clear filters
            </button>
            <Button onClick={() => setOpen(false)}>
              Show {total ?? ""} {noun}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
