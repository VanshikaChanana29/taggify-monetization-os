"use client";

import { ArrowRight, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api";
import { money } from "@/lib/finance";
import type { Deal, DealPartner, DealPartnerShare } from "@/lib/types";

type Row = { partner_id: string; share_pct: string };

/** Who holds part of this deal with Taggify (e.g. Vanshika 50%) and their part of the licence fee. */
export function DealPartners({ deal, onChange }: { deal: Deal; onChange: (message: string) => void }) {
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<DealPartner[]>("/partners")
      .then(setPartners)
      .catch(() => {});
    api<DealPartnerShare[]>(`/deals/${deal.id}/partners`)
      .then((s) => setRows(s.map((x) => ({ partner_id: x.partner_id, share_pct: String(Number(x.share_pct)) }))))
      .catch((err: Error) => setError(err.message));
  }, [deal.id]);
  useEffect(load, [load]);

  if (!rows) return error ? <Notice kind="error">{error}</Notice> : null;
  const total = rows.reduce((t, r) => t + (Number(r.share_pct) || 0), 0);
  const ours = 100 - total;
  const fee = deal.fee_amount !== null && (deal.deal_type === "fixed_fee" || deal.deal_type === "hybrid") ? Number(deal.fee_amount) : null;
  const free = partners.filter((p) => p.is_active && !rows.some((r) => r.partner_id === p.id));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/deals/${deal.id}/partners`, {
        method: "PUT",
        json: { partners: rows!.filter((r) => r.partner_id).map((r) => ({ partner_id: r.partner_id, share_pct: r.share_pct })) },
      });
      onChange("Partners saved. Their channels: open each channel → Edit → Owned by partner.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5 text-primary" /> Deal partners
          </h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Someone who bought this licence with you. They pay you their % of the licence fee, run their own channels, and are paid those
            channels&apos; earnings after the CMS fee (once the CMS pays you), less TDS. {deal.owner_name} stays the content owner.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/partners">
            All partners <ArrowRight />
          </Link>
        </Button>
      </div>

      {partners.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No partners yet.{" "}
          <Link href="/partners" className="font-medium text-primary hover:underline">
            Add one in Partners
          </Link>{" "}
          first, then come back here.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[1fr_7rem_10rem_2.5rem] gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Partner</span>
              <span>Share %</span>
              <span className="text-right">Their part of the fee</span>
              <span />
            </div>
            {rows.map((r, i) => {
              const name = partners.find((p) => p.id === r.partner_id)?.name;
              return (
                <div key={i} className="grid grid-cols-[1fr_7rem_10rem_2.5rem] items-center gap-2 border-t px-3 py-2">
                  <NativeSelect
                    aria-label="Partner"
                    value={r.partner_id}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, partner_id: e.target.value } : x)))}
                  >
                    <option value="">Choose…</option>
                    {name && <option value={r.partner_id}>{name}</option>}
                    {free.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label="Share %"
                    type="number"
                    min="0.01"
                    max="99.99"
                    step="0.01"
                    value={r.share_pct}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share_pct: e.target.value } : x)))}
                  />
                  <span className="text-right text-sm tabular-nums">
                    {fee !== null && r.share_pct ? money((fee * Number(r.share_pct)) / 100, deal.currency) : "—"}
                  </span>
                  <Button variant="ghost" size="icon" aria-label="Remove partner" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_7rem_10rem_2.5rem] items-center gap-2 border-t bg-muted/30 px-3 py-2 text-sm font-semibold">
              <span>Taggify keeps</span>
              <span className={ours <= 0 ? "text-red-600" : ""}>{ours.toFixed(ours % 1 ? 2 : 0)}%</span>
              <span className="text-right tabular-nums">{fee !== null ? money((fee * Math.max(0, ours)) / 100, deal.currency) : "—"}</span>
              <span />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={free.length === 0}
              onClick={() => setRows([...rows, { partner_id: free[0]?.id ?? "", share_pct: "50" }])}
            >
              <Plus /> Add a partner
            </Button>
            <Button size="sm" onClick={save} disabled={saving || ours <= 0}>
              {saving ? "Saving…" : "Save partners"}
            </Button>
            {ours <= 0 && <span className="text-sm text-red-600">Partners together must hold less than 100%.</span>}
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </section>
  );
}
