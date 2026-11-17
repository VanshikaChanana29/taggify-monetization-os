"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TEXTAREA } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { DEAL_TYPE_LABELS, formatMoney } from "@/lib/deals";
import type { ContentOwner, DealType, ParentDeal } from "@/lib/types";

const PAYS_FEE: DealType[] = ["fixed_fee", "hybrid"];

type Form = {
  owner_id: string;
  name: string;
  deal_type: DealType;
  amount: string;
  currency: string;
  term_start: string;
  term_end: string;
  notes: string;
};

function fromParent(p: ParentDeal | null): Form {
  return {
    owner_id: p?.owner_id ?? "",
    name: p?.name ?? "",
    deal_type: p?.deal_type ?? "fixed_fee",
    amount: p?.amount ? String(Number(p.amount)) : "",
    currency: p?.currency ?? "INR",
    term_start: p?.term_start ?? "",
    term_end: p?.term_end ?? "",
    notes: p?.notes ?? "",
  };
}

/** The parent deal: one contract with a content owner. Its shows are added on its page. */
export function ParentDealForm({ parent }: { parent: ParentDeal | null }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => fromParent(parent));
  const [owners, setOwners] = useState<ContentOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const pays = PAYS_FEE.includes(form.deal_type);
  // Type and currency are fixed once shows sit under the deal (their amounts depend on them).
  const locked = (parent?.show_count ?? 0) > 0;

  useEffect(() => {
    api<ContentOwner[]>("/content-owners")
      .then(setOwners)
      .catch(() => {});
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.term_start && form.term_end && form.term_end <= form.term_start) {
      setError("Term end must be after term start.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await api<ParentDeal>(parent ? `/parent-deals/${parent.id}` : "/parent-deals", {
        method: parent ? "PUT" : "POST",
        json: {
          owner_id: form.owner_id,
          name: form.name,
          deal_type: form.deal_type,
          amount: pays ? form.amount || null : null,
          currency: pays ? form.currency : null,
          term_start: form.term_start,
          term_end: form.term_end,
          notes: form.notes || null,
        },
      });
      router.push(`/parent-deals/${saved.id}${parent ? "" : "?added=1"}`);
    } catch (err) {
      setError((err instanceof Error ? err.message : "Could not save the deal").replace(/^Value error,\s*/, ""));
      setSaving(false);
    }
  }

  const selectable = owners.filter((o) => o.is_active || o.id === parent?.owner_id);

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="grid gap-x-4 gap-y-5 rounded-2xl border bg-card p-6 shadow-sm md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Deal name *</Label>
          <Input
            id="name"
            required
            maxLength={200}
            placeholder="e.g. Sony Package 2026"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner">
            Content owner * <InfoTip text={HELP.owner} />
          </Label>
          <NativeSelect id="owner" required value={form.owner_id} onChange={(e) => set({ owner_id: e.target.value })}>
            <option value="">Select an owner…</option>
            {selectable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          {owners.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No owners yet —{" "}
              <Link href="/content-owners" className="text-primary hover:underline">
                add one first
              </Link>
              .
            </p>
          )}
          {locked && <p className="text-xs text-muted-foreground">A new owner is applied to every show in this deal.</p>}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="deal-type">
            Deal type * <InfoTip text={HELP.dealType} />
          </Label>
          <NativeSelect
            id="deal-type"
            className="md:max-w-[calc(50%-0.5rem)]"
            disabled={locked}
            value={form.deal_type}
            onChange={(e) => set({ deal_type: e.target.value as DealType })}
          >
            {(Object.keys(DEAL_TYPE_LABELS) as DealType[]).map((key) => (
              <option key={key} value={key}>
                {DEAL_TYPE_LABELS[key]}
              </option>
            ))}
          </NativeSelect>
          {locked && <p className="text-xs text-muted-foreground">Every show uses this type, so it cannot change once shows are added.</p>}
        </div>
        {pays && (
          <>
            <div className="space-y-2">
              <Label htmlFor="amount">
                {form.deal_type === "hybrid" ? "Total minimum guarantee *" : "Total deal amount *"}{" "}
                <InfoTip text="The whole contract. The shows' own amounts can add up to this much at most." />
              </Label>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
              {parent?.allotted && Number(parent.allotted) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Shows already hold {formatMoney(parent.allotted, parent.currency)} — the amount cannot go below that.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <NativeSelect id="currency" disabled={locked} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                <option value="INR">INR — Indian Rupee</option>
                <option value="USD">USD — US Dollar</option>
                <option value="AED">AED — UAE Dirham</option>
              </NativeSelect>
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="start">
            Start date * <InfoTip text="Shows under this deal must start on or after this date." />
          </Label>
          <Input id="start" type="date" required value={form.term_start} onChange={(e) => set({ term_start: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end">
            End date * <InfoTip text="Shows under this deal must end on or before this date." />
          </Label>
          <Input id="end" type="date" required value={form.term_end} onChange={(e) => set({ term_end: e.target.value })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={3}
            maxLength={5000}
            className={TEXTAREA}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </section>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : parent ? "Save deal" : "Create deal"}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
