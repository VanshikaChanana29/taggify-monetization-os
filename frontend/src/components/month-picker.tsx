"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMonth, shiftMonth, thisMonth } from "@/lib/finance";

/** ‹ October 2026 › with a native month input for jumping further. */
export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const atLatest = month >= thisMonth();
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-1 shadow-sm">
      <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft />
      </Button>
      <label className="relative cursor-pointer px-2 text-sm font-semibold">
        {formatMonth(month)}
        <input
          type="month"
          aria-label="Choose month"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={month}
          max={thisMonth()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </label>
      <Button variant="ghost" size="icon" aria-label="Next month" disabled={atLatest} onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight />
      </Button>
    </div>
  );
}
