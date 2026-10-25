"use client";

import { bands, slabSummary } from "@/components/fee-slabs";
import { Layers, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { useOrganization } from "@/components/session-provider";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { CmsPartner, Platform } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { ListFilters } from "@/components/list-filters";

const SORT_BY = {
  name: (c: CmsPartner) => c.name,
  platform: (c: CmsPartner) => c.platform,
  channels: (c: CmsPartner) => c.channel_count,
};

type Form = { name: string; platform: Platform | ""; notes: string; is_active: boolean; fee_after_tax: boolean };
const EMPTY: Form = { name: "", platform: "", notes: "", is_active: true, fee_after_tax: false };

const compactMoney = (v: number, cur: string) =>
  `${cur === "INR" ? "₹" : "$"}${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;

/** Every CMS partner with its contract slabs; a row opens that CMS's page in CMS & Finance. */
export function CmsPartnersList() {
  const organization = useOrganization();
  const [rows, setRows] = useState<CmsPartner[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [added, setAdded] = useState<CmsPartner | null>(null);

  const load = useCallback(() => {
    api<CmsPartner[]>("/cms-partners")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function start(row: CmsPartner | null) {
    setError(null);
    setNotice(null);
    setAdded(null);
    setEditing(row ? row.id : "new");
    setForm(
      row ? { name: row.name, platform: row.platform, notes: row.notes ?? "", is_active: row.is_active, fee_after_tax: row.fee_after_tax } : EMPTY,
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<CmsPartner>(editing === "new" ? "/cms-partners" : `/cms-partners/${editing}`, {
        method: editing === "new" ? "POST" : "PUT",
        json: form,
      });
      // Back to the list, like every "New …"; a new CMS still needs its fee slabs, so link to them.
      if (editing === "new") setAdded(saved);
      else setNotice(`${saved.name} saved.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!platform || r.platform === platform));
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: `${q}|${platform}`,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          The CMS networks (YouTube) and business portfolios (Facebook) {organization.name}&apos;s channels earn through. Open one to see its contract
          slabs, statements, bank receipts and what it still owes.
        </p>
        <Button size="lg" onClick={() => start(null)}>
          <Plus />
          New CMS
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {added && (
        <Notice kind="success">
          {added.name} added.{" "}
          <a href={`/finance/${added.id}?tab=slabs&slabs=new`} className="font-semibold underline">
            Add its fee slabs now
          </a>
          : a CMS without them cannot be settled.
        </Notice>
      )}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} wide title={editing === "new" ? "New CMS partner" : `Edit ${form.name}`}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform *</Label>
            <NativeSelect id="platform" required value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}>
              <option value="">Select…</option>
              <option value="youtube">YouTube CMS</option>
              <option value="facebook">Facebook business portfolio</option>
            </NativeSelect>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              checked={form.fee_after_tax}
              onChange={(e) => setForm({ ...form, fee_after_tax: e.target.checked })}
            />
            <span>
              Fee is charged after tax
              <span className="block text-xs text-muted-foreground">
                Tick if this CMS first deducts tax (e.g. 15% US tax) and then takes its fee on what is left.
              </span>
            </span>
          </label>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
            </label>
          )}
          <div className="md:col-span-2">
            {error && <Notice kind="error">{error}</Notice>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <ListFilters
        search={query}
        onSearch={setQuery}
        placeholder="Search CMS…"
        fields={[
          {
            key: "platform",
            label: "Platform",
            options: [
              ["", "All platforms"],
              ["youtube", "YouTube"],
              ["facebook", "Facebook"],
            ],
          },
        ]}
        values={{ platform }}
        onChange={(_, value) => setPlatform(value)}
        onClear={() => {
          setQuery("");
          setPlatform("");
        }}
        total={table.total}
        noun="partners"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="CMS" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Platform" sortKey="platform" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Channels" sortKey="channels" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Fee slabs</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((r, idx) => (
              <TableRow key={r.id}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
                <TableCell>
                  <a href={`/finance/${r.id}?tab=slabs`} className="font-semibold hover:text-primary">
                    {r.name}
                  </a>
                  {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  {r.fee_after_tax && <p className="text-xs text-muted-foreground">Fee after tax</p>}
                </TableCell>
                <TableCell>
                  <Pill tone={PLATFORM_TONES[r.platform]}>{PLATFORM_LABELS[r.platform]}</Pill>
                </TableCell>
                <TableCell className="font-semibold">{r.channel_count}</TableCell>
                <TableCell>
                  {r.slabs ? (
                    <a href={`/finance/${r.id}?tab=slabs`} className="group block">
                      <span className="font-semibold group-hover:text-primary">{slabSummary(r.slabs)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {bands(r.slabs.tiers)
                          .map((b, i, all) => (all.length === 1 ? "any amount" : b.to === null ? `${compactMoney(b.from, r.slabs!.currency)}+` : `≤${compactMoney(b.to, r.slabs!.currency)}`))
                          .join(" · ")}
                        {r.slabs.tier_type === "marginal" ? " · each part at its rate" : ""}
                      </span>
                    </a>
                  ) : (
                    <a
                      href={`/finance/${r.id}?tab=slabs&slabs=new`}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:underline dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      <Plus className="h-3 w-3" /> Add slabs
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill active={r.is_active} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/finance/${r.id}?tab=slabs`}>
                        <Layers />
                        {r.slabs ? "Slabs" : "Add slabs"}
                      </a>
                    </Button>
                    <Button variant="outline" size="icon" aria-label={`Edit ${r.name}`} onClick={() => start(r)}>
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={7}>{rows.length ? "No CMS partners match these filters." : "No CMS partners yet — add CMS A."}</EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="partners"
        />
      </div>
    </div>
  );
}
