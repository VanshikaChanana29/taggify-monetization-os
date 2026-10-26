"use client";

import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SlabExample, SlabLadder, SlabsDialog, slabSummary, TYPE_TEXT } from "@/components/fee-slabs";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatMonth, thisMonth } from "@/lib/finance";
import type { FeeSchedule } from "@/lib/types";

/** The schedule in force this month; if none has started yet, the first one to come. */
export function inForce(schedules: FeeSchedule[]): FeeSchedule | null {
  const now = `${thisMonth()}-01`;
  const sorted = [...schedules].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return sorted.filter((s) => s.effective_from <= now).pop() ?? sorted[0] ?? null;
}

/** A CMS's contract slabs: the ones in force up front, a worked example, and the history. */
export function CmsSlabsPanel({
  cmsId,
  cmsName,
  channelCount,
  afterTax = false,
  openSignal = 0,
  onChanged,
}: {
  cmsId: string;
  cmsName: string;
  channelCount: number;
  /** The CMS takes its fee on earnings after tax. */
  afterTax?: boolean;
  /** Bump to open the add / change slabs popup. */
  openSignal?: number;
  onChanged?: () => void;
}) {
  const [schedules, setSchedules] = useState<FeeSchedule[] | null>(null);
  const [editing, setEditing] = useState(openSignal > 0);
  useEffect(() => {
    if (openSignal > 0) setEditing(true);
  }, [openSignal]);
  const [sample, setSample] = useState("25000");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<FeeSchedule[]>(`/cms-partners/${cmsId}/fee-schedules`)
      .then(setSchedules)
      .catch((err: Error) => setError(err.message));
  }, [cmsId]);
  useEffect(load, [load]);

  async function remove(s: FeeSchedule) {
    if (!window.confirm(`Delete the slabs that start in ${formatMonth(s.effective_from.slice(0, 7))}?`)) return;
    try {
      await api(`/fee-schedules/${s.id}`, { method: "DELETE" });
      setNotice(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!schedules) return error ? <Notice kind="error">{error}</Notice> : null;
  const current = inForce(schedules);
  const others = schedules.filter((s) => s.id !== current?.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const now = `${thisMonth()}-01`;

  return (
    <div className="space-y-6">
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {current ? (
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Layers className="h-4 w-4" /> Contract slabs {current.effective_from > now ? "(starting soon)" : "in force"}
              </p>
              <h2 className="mt-1 text-2xl font-bold">{slabSummary(current)}</h2>
              <p className="text-sm text-muted-foreground">
                Since {formatMonth(current.effective_from.slice(0, 7))} · {TYPE_TEXT[current.tier_type].title.toLowerCase()} · in {current.currency}
              </p>
            </div>
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Change slabs
            </Button>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <SlabLadder slabs={current} example={Number(sample) || 0} />
            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <p className="font-semibold">{TYPE_TEXT[current.tier_type].title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{TYPE_TEXT[current.tier_type].text}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  The month&apos;s total of <b>all {channelCount} channels</b> under {cmsName} decides the slab — not each channel or deal on its own.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor={`sample-${cmsId}`} className="font-medium">
                    Try a month&apos;s earnings
                  </label>
                  <Input id={`sample-${cmsId}`} className="w-36" type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} />
                </div>
                <SlabExample slabs={current} gross={Number(sample) || 0} name={cmsName} afterTax={afterTax} />
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-10 text-center dark:border-amber-500/40 dark:bg-amber-500/10">
          <Layers className="h-8 w-8 text-amber-600" />
          <h2 className="text-xl font-semibold">No contract slabs yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Add the slabs from {cmsName}&apos;s contract (for example: up to $10,000 → 15%, above that → 12%). Until then the tool cannot work out
            what {cmsName} owes.
          </p>
          <Button size="lg" onClick={() => setEditing(true)}>
            <Plus /> Add contract slabs
          </Button>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Other slabs</h3>
          <p className="-mt-2 text-sm text-muted-foreground">
            Each month uses the slabs that had started by then, so past months keep the rates they had.
          </p>
          {others.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4 shadow-sm">
              <div>
                <p className="font-semibold">
                  From {formatMonth(s.effective_from.slice(0, 7))}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{s.effective_from > now ? "upcoming" : "earlier"}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {slabSummary(s)} · {TYPE_TEXT[s.tier_type].title.toLowerCase()} · {s.currency}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Delete these slabs" onClick={() => remove(s)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </section>
      )}
      {current && (
        <button
          type="button"
          onClick={() => remove(current)}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-red-600 hover:underline"
        >
          Delete the slabs in force
        </button>
      )}

      {editing && (
        <SlabsDialog
          open={editing}
          onClose={() => setEditing(false)}
          cmsId={cmsId}
          cmsName={cmsName}
          start={current}
          existing={schedules}
          afterTax={afterTax}
          onSaved={(m) => {
            setNotice(m);
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
