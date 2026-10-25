"use client";

import { ArrowLeft, ArrowRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SlabExample, SlabLadder, SlabsDialog, slabSummary, TYPE_TEXT } from "@/components/fee-slabs";
import { PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatMonth, shiftMonth, thisMonth } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { CmsPartner, FeeSchedule } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The schedule in force this month; if none has started yet, the first one to come. */
function inForce(schedules: FeeSchedule[]): FeeSchedule | null {
  const now = `${thisMonth()}-01`;
  const sorted = [...schedules].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return sorted.filter((s) => s.effective_from <= now).pop() ?? sorted[0] ?? null;
}

export default function CmsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cms, setCms] = useState<CmsPartner | null>(null);
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [editing, setEditing] = useState(false);
  const [sample, setSample] = useState("25000");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Arriving from "New CMS" or "Add slabs": open the slabs form straight away.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tiers") === "new") setEditing(true);
  }, []);

  const load = useCallback(() => {
    api<CmsPartner[]>("/cms-partners")
      .then((all) => setCms(all.find((c) => c.id === id) ?? null))
      .catch((err: Error) => setError(err.message));
    api<FeeSchedule[]>(`/cms-partners/${id}/fee-schedules`).then(setSchedules).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function remove(s: FeeSchedule) {
    if (!window.confirm(`Delete the slabs that start in ${formatMonth(s.effective_from.slice(0, 7))}?`)) return;
    try {
      await api(`/fee-schedules/${s.id}`, { method: "DELETE" });
      setNotice(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!cms) return error ? <Notice kind="error">{error}</Notice> : <PageLoader />;
  const current = inForce(schedules);
  const others = schedules.filter((s) => s.id !== current?.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const now = `${thisMonth()}-01`;

  return (
    <div className="space-y-8">
      <Link href="/cms-partners" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        CMS partners
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{cms.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Pill tone={PLATFORM_TONES[cms.platform]}>{PLATFORM_LABELS[cms.platform]}</Pill>
            <span className="text-sm text-muted-foreground">
              {cms.channel_count} channel{cms.channel_count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/finance/${cms.id}?month=${shiftMonth(thisMonth(), -1)}`}>
            Money from {cms.name} <ArrowRight />
          </Link>
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {/* The slabs in force, front and centre */}
      {current ? (
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Layers className="h-4 w-4" /> Fee slabs {current.effective_from > now ? "(starting soon)" : "in force"}
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
                  The month&apos;s total of <b>all {cms.channel_count} channels</b> under {cms.name} decides the slab — not each channel or deal on its own.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor="cms-sample" className="font-medium">
                    Try a month&apos;s earnings
                  </label>
                  <Input id="cms-sample" className="w-36" type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} />
                </div>
                <SlabExample slabs={current} gross={Number(sample) || 0} name={cms.name} />
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-10 text-center dark:border-amber-500/40 dark:bg-amber-500/10">
          <Layers className="h-8 w-8 text-amber-600" />
          <h2 className="text-xl font-semibold">No fee slabs yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Add the slabs from {cms.name}&apos;s contract (for example: up to $10,000 → 15%, above that → 12%). Until then the tool cannot work out what {cms.name} owes.
          </p>
          <Button size="lg" onClick={() => setEditing(true)}>
            <Plus /> Add fee slabs
          </Button>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Other slabs</h3>
          <p className="-mt-2 text-sm text-muted-foreground">Each month uses the slabs that had started by then, so past months keep the rates they had.</p>
          {others.map((s) => (
            <div key={s.id} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4 shadow-sm")}>
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
        <button type="button" onClick={() => remove(current)} className="text-sm text-muted-foreground underline-offset-4 hover:text-red-600 hover:underline">
          Delete the slabs in force
        </button>
      )}

      {editing && (
        <SlabsDialog
          open={editing}
          onClose={() => setEditing(false)}
          cmsId={cms.id}
          cmsName={cms.name}
          start={current}
          existing={schedules}
          onSaved={(m) => {
            setNotice(m);
            load();
          }}
        />
      )}
    </div>
  );
}
