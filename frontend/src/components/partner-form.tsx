"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { DealPartner } from "@/lib/types";

/** New / edit a deal partner (name, contact, TDS %). Used inside a Dialog. */
export function PartnerForm({
  partner,
  onSaved,
  onCancel,
}: {
  partner: DealPartner | null;
  onSaved: (p: DealPartner) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: partner?.name ?? "",
    email: partner?.email ?? "",
    phone: partner?.phone ?? "",
    tds_pct: partner?.tds_pct ? String(Number(partner.tds_pct)) : "",
    notes: partner?.notes ?? "",
    is_active: partner?.is_active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api<DealPartner>(partner ? `/partners/${partner.id}` : "/partners", {
        method: partner ? "PUT" : "POST",
        json: { ...form, tds_pct: form.tds_pct === "" ? null : form.tds_pct },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="pt-name">Name *</Label>
        <Input
          id="pt-name"
          required
          maxLength={120}
          placeholder="e.g. Vanshika"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pt-email">Email</Label>
        <Input id="pt-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pt-phone">Phone</Label>
        <Input id="pt-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pt-tds">TDS % on payments to them</Label>
        <Input
          id="pt-tds"
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="e.g. 10"
          value={form.tds_pct}
          onChange={(e) => setForm({ ...form, tds_pct: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Taken off each payment. Leave empty until the founders confirm the rate.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pt-notes">Notes</Label>
        <Input id="pt-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      {partner && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : partner ? "Save" : "Add partner"}
          </Button>
        </DialogFooter>
      </div>
    </form>
  );
}
