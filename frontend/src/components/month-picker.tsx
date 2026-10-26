"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMonth, shiftMonth, thisMonth } from "@/lib/finance";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ‹ October 2026 › — click the month to open a calendar of months and jump to any of them. */
export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const latest = thisMonth();
  const atLatest = month >= latest;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setYear(Number(month.slice(0, 4)));
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, month]);

  function pick(m: string) {
    onChange(m);
    setOpen(false);
  }

  const latestYear = Number(latest.slice(0, 4));
  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Choose month, now ${formatMonth(month)}`}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted",
            open && "bg-muted",
          )}
        >
          <CalendarDays className="h-4 w-4 text-primary" />
          {formatMonth(month)}
        </button>
        <Button variant="ghost" size="icon" aria-label="Next month" disabled={atLatest} onClick={() => onChange(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
      </div>

      {open && (
        <div role="dialog" aria-label="Choose a month" className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border bg-popover p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft />
            </Button>
            <span className="font-semibold tabular-nums">{year}</span>
            <Button variant="ghost" size="icon" aria-label="Next year" disabled={year >= latestYear} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((label, i) => {
              const m = `${year}-${String(i + 1).padStart(2, "0")}`;
              const future = m > latest;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={future}
                  onClick={() => pick(m)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-medium transition-colors",
                    m === month ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    m === latest && m !== month && "ring-1 ring-primary/40",
                    future && "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t pt-2 text-sm">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => pick(shiftMonth(latest, -1))}>
              Last month
            </button>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => pick(latest)}>
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
