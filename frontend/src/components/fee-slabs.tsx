"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api";
import { formatMonth, money, thisMonth } from "@/lib/finance";
import type { Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TierType = "whole" | "marginal";
export type Slabs = { tier_type: TierType; currency: string; tiers: Tier[]; effective_from?: string };

/** Same maths as the backend (services/cms_fees.py). */
export function feeFor(gross: number, type: TierType, tiers: Tier[]): number {
  const t = tiers.map((x) => [Number(x.from_amount), Number(x.rate_pct)] as const).sort((a, b) => a[0] - b[0]);
  if (type === "whole") {
    let rate = 0;
    for (const [from, r] of t) if (gross >= from) rate = r;
    return (gross * rate) / 100;
  }
  return t.reduce((fee, [from, r], i) => {
    const end = i + 1 < t.length ? t[i + 1][0] : Infinity;
    return fee + (Math.max(0, Math.min(gross, end) - from) * r) / 100;
  }, 0);
}

type Band = { from: number; to: number | null; rate: number };

export function bands(tiers: Tier[]): Band[] {
  const t = [...tiers].map((x) => ({ from: Number(x.from_amount), rate: Number(x.rate_pct) })).sort((a, b) => a.from - b.from);
  return t.map((x, i) => ({ ...x, to: i + 1 < t.length ? t[i + 1].from : null }));
}

export function bandLabel(b: Band, cur: string, only: boolean): string {
  const m = (v: number) => money(v, cur);
  if (only) return "Any amount";
  if (b.from === 0 && b.to !== null) return `Up to ${m(b.to)}`;
  if (b.to === null) return `Above ${m(b.from)}`;
  return `${m(b.from)} – ${m(b.to)}`;
}

/** "15% → 12% → 10% → 8%" or "11% on everything". */
export function slabSummary(s: Slabs): string {
  const b = bands(s.tiers);
  return b.length === 1 ? `${b[0].rate}% on everything` : b.map((x) => `${x.rate}%`).join(" → ");
}

export const TYPE_TEXT: Record<TierType, { title: string; text: string }> = {
  whole: { title: "Whole amount at one rate", text: "The month's total decides the slab, and that one rate applies to all of it." },
  marginal: { title: "Each part at its own rate", text: "Like income-tax slabs: the first part at the first rate, the next part at the next rate, and so on." },
};

/** The slabs as a ladder: one row per band, the example month's band highlighted. */
export function SlabLadder({ slabs, example }: { slabs: Slabs; example?: number }) {
  const b = bands(slabs.tiers);
  const max = Math.max(...b.map((x) => x.rate), 1);
  return (
    <ol className="space-y-2">
      {b.map((x) => {
        const hit = example !== undefined && example >= x.from && (x.to === null || example < x.to);
        return (
          <li
            key={x.from}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_3.5rem] items-center gap-3 rounded-xl border px-4 py-3",
              hit ? "border-primary/50 bg-primary/5" : "bg-card",
            )}
          >
            <span className="truncate text-sm font-medium">{bandLabel(x, slabs.currency, b.length === 1)}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary/80" style={{ width: `${(x.rate / max) * 100}%` }} />
            </span>
            <span className="text-right text-lg font-bold tabular-nums">{x.rate}%</span>
          </li>
        );
      })}
    </ol>
  );
}

/** "If the CMS earns $25,000 in a month …" worked out in words. */
export function SlabExample({ slabs, gross, name }: { slabs: Slabs; gross: number; name: string }) {
  const cur = slabs.currency;
  const fee = feeFor(gross, slabs.tier_type, slabs.tiers);
  const b = bands(slabs.tiers);
  const parts =
    slabs.tier_type === "marginal"
      ? b
          .filter((x) => gross > x.from)
          .map((x) => {
            const amount = Math.min(gross, x.to ?? Infinity) - x.from;
            return `${x.rate}% of ${money(amount, cur)} = ${money((amount * x.rate) / 100, cur)}`;
          })
      : [];
  const rate = gross ? (fee / gross) * 100 : 0;
  return (
    <div className="rounded-xl bg-muted/50 p-4 text-sm">
      <p>
        If {name} earns <b>{money(gross, cur)}</b> in a month, its fee is <b>{money(fee, cur)}</b>
        {slabs.tier_type === "whole" ? ` (${rate.toFixed(rate % 1 ? 1 : 0)}% on all of it)` : ` (${rate.toFixed(1)}% overall)`} and we get{" "}
        <b className="text-emerald-700 dark:text-emerald-400">{money(gross - fee, cur)}</b>.
      </p>
      {parts.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{parts.join(" + ")}</p>}
    </div>
  );
}

// ---- Add / change slabs -----------------------------------------------------------------------------

type Row = { upto: string; rate: string };

function toRows(tiers: Tier[]): Row[] {
  const b = bands(tiers);
  return b.map((x) => ({ upto: x.to === null ? "" : String(x.to), rate: String(x.rate) }));
}

export function SlabsDialog({
  open,
  onClose,
  cmsId,
  cmsName,
  start,
  existing = [],
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  cmsId: string;
  cmsName: string;
  start?: Slabs | null;
  /** Slabs already saved; picking one of their months replaces it. */
  existing?: { id: string; effective_from: string }[];
  onSaved: (message: string) => void;
}) {
  const [month, setMonth] = useState(thisMonth());
  const [type, setType] = useState<TierType>(start?.tier_type ?? "whole");
  const [currency, setCurrency] = useState(start?.currency ?? "USD");
  const [rows, setRows] = useState<Row[]>(
    start
      ? toRows(start.tiers)
      : [
          { upto: "10000", rate: "15" },
          { upto: "20000", rate: "12" },
          { upto: "50000", rate: "10" },
          { upto: "", rate: "8" },
        ],
  );
  const [sample, setSample] = useState("25000");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const froms = rows.map((_, i) => (i === 0 ? 0 : Number(rows[i - 1].upto) || 0));
  const tiers: Tier[] = rows.map((r, i) => ({ from_amount: String(froms[i]), rate_pct: r.rate }));
  const problem = rows.slice(0, -1).find((r, i) => !(Number(r.upto) > froms[i])) ? "Each slab must end above where it starts." : null;
  const set = (i: number, change: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const slabs: Slabs = { tier_type: type, currency, tiers };
  const replacing = existing.find((x) => x.effective_from.slice(0, 7) === month);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      if (replacing) await api(`/fee-schedules/${replacing.id}`, { method: "DELETE" });
      await api(`/cms-partners/${cmsId}/fee-schedules`, {
        method: "POST",
        json: { effective_from: `${month}-01`, tier_type: type, currency, tiers },
      });
      onSaved(`${cmsName}'s fee slabs from ${formatMonth(month)} are saved.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title={start ? `Change ${cmsName}'s fee slabs` : `${cmsName}'s fee slabs`} description="Copy them from the CMS contract. The fee is worked out on the month's total earnings of all this CMS's channels together.">
      <form onSubmit={save} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div className="space-y-1">
            <Label htmlFor="sl-month">Start from month *</Label>
            <Input id="sl-month" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} />
            <p className={cn("text-xs", replacing ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
              {replacing ? `This replaces the slabs that start in ${formatMonth(month)}.` : "Earlier months keep their old slabs."}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sl-cur">Currency</Label>
            <NativeSelect id="sl-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="INR">INR</option>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Slabs *</Label>
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[1fr_1fr_6rem_2.5rem] gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>From</span>
              <span>Up to</span>
              <span>Fee %</span>
              <span />
            </div>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_6rem_2.5rem] items-center gap-2 border-t px-3 py-2">
                  <span className="text-sm tabular-nums text-muted-foreground">{money(froms[i], currency)}</span>
                  {last ? (
                    <span className="text-sm text-muted-foreground">and above</span>
                  ) : (
                    <Input aria-label={`Slab ${i + 1} up to`} type="number" min="0" step="0.01" required value={r.upto} onChange={(e) => set(i, { upto: e.target.value })} />
                  )}
                  <Input aria-label={`Slab ${i + 1} fee %`} type="number" min="0" max="100" step="0.01" required value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} />
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove slab ${i + 1}`}
                      onClick={() =>
                        setRows((rs) => {
                          const next = rs.filter((_, j) => j !== i);
                          next[next.length - 1] = { ...next[next.length - 1], upto: "" };
                          return next;
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((rs) => {
                const lastFrom = rs.length > 1 ? Number(rs[rs.length - 2].upto) || 0 : 0;
                const next = [...rs];
                next[next.length - 1] = { ...next[next.length - 1], upto: String(lastFrom ? lastFrom * 2 : 10000) };
                return [...next, { upto: "", rate: "" }];
              })
            }
          >
            <Plus /> Add a slab
          </Button>
        </div>

        <div className="space-y-2">
          <Label>How does the CMS apply them? *</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["whole", "marginal"] as TierType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={cn("rounded-xl border-2 p-4 text-left transition-colors", type === t ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}
              >
                <p className="font-semibold">{TYPE_TEXT[t].title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{TYPE_TEXT[t].text}</p>
                <p className="mt-2 text-sm">
                  On {money(Number(sample) || 0, currency)}: fee <b>{money(feeFor(Number(sample) || 0, t, tiers), currency)}</b>
                </p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Not sure? Check the CMS contract, or ask the founder — the two give different fees.</p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor="sl-sample">Try a month&apos;s earnings</Label>
            <Input id="sl-sample" className="w-36" type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} />
          </div>
          <SlabExample slabs={slabs} gross={Number(sample) || 0} name={cmsName} />
        </div>

        {(error || problem) && <p className="text-sm text-red-600 dark:text-red-400">{error ?? problem}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || Boolean(problem)}>
            {saving ? "Saving…" : "Save slabs"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
