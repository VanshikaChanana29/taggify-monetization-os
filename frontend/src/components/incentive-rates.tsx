"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/deals";
import type { IncentiveKind, IncentiveRate } from "@/lib/types";

const KIND_LABEL: Record<IncentiveKind, string> = {
  manager: "On channels they manage",
  team_lead: "On their team's channels (as lead)",
};

/** A person's incentive % history (PDF slide 12). Newest rate from its date wins. */
export function IncentiveRates({ employeeId, canLead }: { employeeId: string; canLead: boolean }) {
  const [rates, setRates] = useState<IncentiveRate[]>([]);
  const [form, setForm] = useState({ kind: "manager" as IncentiveKind, rate_pct: "", effective_from: todayISO().slice(0, 8) + "01" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<IncentiveRate[]>(`/employees/${employeeId}/incentive-rates`).then(setRates).catch(() => {});
  }, [employeeId]);
  useEffect(load, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/employees/${employeeId}/incentive-rates`, { method: "POST", json: form });
      setForm({ ...form, rate_pct: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function remove(rate: IncentiveRate) {
    if (!window.confirm("Delete this rate?")) return;
    setError(null);
    try {
      await api(`/incentive-rates/${rate.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  const current = (kind: IncentiveKind) => rates.filter((r) => r.kind === kind && r.effective_from <= todayISO())[0];

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">Incentive rates</h3>
      <p className="text-sm text-muted-foreground">% of channel gross, before the CMS fee. Changes apply from their date; past months never move.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {(["manager", ...(canLead ? ["team_lead"] : [])] as IncentiveKind[]).map((k) => (
          <div key={k} className="rounded-xl bg-muted/60 p-3">
            <p className="text-muted-foreground">{k === "manager" ? "As manager" : "As team lead"}</p>
            <p className="text-xl font-bold">{current(k) ? `${Number(current(k).rate_pct)}%` : "—"}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {rates.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-semibold">{Number(r.rate_pct)}%</span>{" "}
              <span className="text-muted-foreground">
                {KIND_LABEL[r.kind]} · from {formatDate(r.effective_from)}
              </span>
            </span>
            <Button variant="ghost" size="icon" aria-label="Delete rate" onClick={() => remove(r)}>
              <Trash2 />
            </Button>
          </li>
        ))}
        {rates.length === 0 && <li className="text-muted-foreground">No rate yet — this person earns no incentive.</li>}
      </ul>
      <form onSubmit={add} className="mt-4 space-y-3 border-t pt-4">
        <div className="space-y-1">
          <Label htmlFor="ir-kind">Type</Label>
          <NativeSelect id="ir-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as IncentiveKind })}>
            <option value="manager">{KIND_LABEL.manager}</option>
            {canLead && <option value="team_lead">{KIND_LABEL.team_lead}</option>}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="ir-rate">Rate % *</Label>
            <Input id="ir-rate" type="number" min="0" max="100" step="0.001" required placeholder="1" value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ir-from">From *</Label>
            <Input id="ir-from" type="date" required value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <Button type="submit" className="w-full">
          Add rate
        </Button>
      </form>
    </section>
  );
}
