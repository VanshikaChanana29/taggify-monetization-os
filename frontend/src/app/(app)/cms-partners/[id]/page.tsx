"use client";

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { formatMonth, money, thisMonth } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { CmsPartner, FeeSchedule, Tier } from "@/lib/types";

const EXAMPLE: Tier[] = [
  { from_amount: "0", rate_pct: "20" },
  { from_amount: "20000", rate_pct: "15" },
];

/** Same maths as the backend, to preview a schedule while typing. */
function previewFee(gross: number, type: "whole" | "marginal", tiers: Tier[]): number {
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

export default function CmsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cms, setCms] = useState<CmsPartner | null>(null);
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ month: thisMonth(), tier_type: "whole" as "whole" | "marginal", currency: "USD", tiers: EXAMPLE });
  const [sample, setSample] = useState("25000");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CmsPartner[]>("/cms-partners")
      .then((all) => setCms(all.find((c) => c.id === id) ?? null))
      .catch((err: Error) => setError(err.message));
    api<FeeSchedule[]>(`/cms-partners/${id}/fee-schedules`).then(setSchedules).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  const setTier = (i: number, change: Partial<Tier>) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, ...change } : t)) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api(`/cms-partners/${id}/fee-schedules`, {
        method: "POST",
        json: { effective_from: `${form.month}-01`, tier_type: form.tier_type, currency: form.currency, tiers: form.tiers },
      });
      setNotice(`Fee tiers from ${formatMonth(form.month)} saved.`);
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function remove(s: FeeSchedule) {
    if (!window.confirm(`Delete the tiers from ${formatMonth(s.effective_from.slice(0, 7))}?`)) return;
    try {
      await api(`/fee-schedules/${s.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!cms) return error ? <Notice kind="error">{error}</Notice> : <p className="text-muted-foreground">Loading…</p>;
  const fee = previewFee(Number(sample) || 0, form.tier_type, form.tiers);

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
            <span className="text-sm text-muted-foreground">{cms.channel_count} channel(s)</span>
          </div>
        </div>
        <Button size="lg" onClick={() => setAdding(true)}>
          <Plus />
          New fee tiers
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {adding && (
        <form onSubmit={save} className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">New fee tiers <InfoTip text={HELP.feeTiers} /></h3>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fs-month">Applies from (month) *</Label>
              <Input id="fs-month" type="month" required value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fs-type">How tiers work * <InfoTip text={HELP.tierType} /></Label>
              <NativeSelect id="fs-type" value={form.tier_type} onChange={(e) => setForm({ ...form, tier_type: e.target.value as "whole" | "marginal" })}>
                <option value="whole">Whole revenue — the reached tier&apos;s rate applies to everything</option>
                <option value="marginal">Marginal — each band at its own rate (like tax slabs)</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fs-cur">Currency of the thresholds</Label>
              <NativeSelect id="fs-cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="USD">USD</option>
                <option value="INR">INR</option>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tiers (monthly gross across all of this CMS&apos;s channels)</Label>
            {form.tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-16 text-muted-foreground">{i === 0 ? "From" : "From"}</span>
                <Input
                  aria-label="From amount"
                  className="w-36"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  disabled={i === 0}
                  value={t.from_amount}
                  onChange={(e) => setTier(i, { from_amount: e.target.value })}
                />
                <span className="text-muted-foreground">{form.currency} →</span>
                <Input aria-label="Rate %" className="w-24" type="number" min="0" max="100" step="0.01" required value={t.rate_pct} onChange={(e) => setTier(i, { rate_pct: e.target.value })} />
                <span className="text-muted-foreground">%</span>
                {i > 0 && (
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove tier" onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, tiers: [...form.tiers, { from_amount: "", rate_pct: "" }] })}>
              <Plus />
              Add tier
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 p-4 text-sm">
            Try it: a month with gross
            <Input aria-label="Sample gross" className="w-32" type="number" value={sample} onChange={(e) => setSample(e.target.value)} />
            {form.currency} → fee <span className="font-bold">{money(fee, form.currency)}</span>, net due{" "}
            <span className="font-bold">{money((Number(sample) || 0) - fee, form.currency)}</span>
          </div>
          <div className="flex gap-3">
            <Button type="submit">Save tiers</Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Fee tiers over time <InfoTip text={HELP.feeTiers} /></h3>
        {schedules.map((s, idx) => (
          <div key={s.id} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                From {formatMonth(s.effective_from.slice(0, 7))}
                {idx === 0 && <span className="ml-2 text-xs font-normal text-emerald-600">latest</span>}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{s.tier_type === "whole" ? "Whole revenue" : "Marginal"} · {s.currency}</span>
                <Button variant="ghost" size="icon" aria-label="Delete schedule" onClick={() => remove(s)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-sm">
              {s.tiers.map((t, i) => (
                <span key={i} className="mr-4">
                  {money(t.from_amount, s.currency)}+ → <span className="font-semibold">{Number(t.rate_pct)}%</span>
                </span>
              ))}
            </p>
          </div>
        ))}
        {schedules.length === 0 && (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            No fee tiers yet — settlements for {cms.name} will show the fee as missing until you add them.
          </p>
        )}
      </section>
    </div>
  );
}
