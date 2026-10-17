"use client";

import { Pencil, Plus, Server, Tv } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, FilterBar, SearchInput, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { useOrganization } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
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

const SORT_BY = {
  name: (c: CmsPartner) => c.name,
  platform: (c: CmsPartner) => c.platform,
  channels: (c: CmsPartner) => c.channel_count,
};

type Form = { name: string; platform: Platform | ""; notes: string; is_active: boolean };
const EMPTY: Form = { name: "", platform: "", notes: "", is_active: true };

export default function CmsPartnersPage() {
  const organization = useOrganization();
  const [rows, setRows] = useState<CmsPartner[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CmsPartner[]>("/cms-partners")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function start(row: CmsPartner | null) {
    setError(null);
    setNotice(null);
    setEditing(row ? row.id : "new");
    setForm(row ? { name: row.name, platform: row.platform, notes: row.notes ?? "", is_active: row.is_active } : EMPTY);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<CmsPartner>(editing === "new" ? "/cms-partners" : `/cms-partners/${editing}`, {
        method: editing === "new" ? "POST" : "PUT",
        json: form,
      });
      setNotice(`${saved.name} saved.`);
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
    <div className="space-y-8">
      <PageHeader
        title="CMS partners"
        description={`The CMS networks (YouTube) and business portfolios (Facebook) ${organization.name}'s channels earn through. Fee tiers come in Part 4.`}
        actions={
          <Button size="lg" onClick={() => start(null)}>
            <Plus />
            New CMS
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        <StatCard label="Active partners" value={rows.filter((r) => r.is_active).length} icon={Server} />
        <StatCard label="Channels linked" value={rows.reduce((n, r) => n + r.channel_count, 0)} icon={Tv} tone="green" />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {editing && (
        <form onSubmit={save} className="grid gap-4 rounded-2xl border bg-card p-6 shadow-sm md:grid-cols-2">
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
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
          )}
          <div className="flex gap-3 md:col-span-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <FilterBar active={Boolean(q || platform)} onClear={() => { setQuery(""); setPlatform(""); }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search CMS…" />
        <NativeSelect aria-label="Filter by platform" className="w-44" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">All platforms</option>
          <option value="youtube">YouTube</option>
          <option value="facebook">Facebook</option>
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="CMS" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Platform" sortKey="platform" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Channels" sortKey="channels" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <a href={`/cms-partners/${r.id}`} className="font-semibold hover:text-primary">
                    {r.name}
                  </a>
                  {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                </TableCell>
                <TableCell>
                  <Pill tone={PLATFORM_TONES[r.platform]}>{PLATFORM_LABELS[r.platform]}</Pill>
                </TableCell>
                <TableCell className="font-semibold">{r.channel_count}</TableCell>
                <TableCell>
                  <StatusPill active={r.is_active} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="icon" aria-label={`Edit ${r.name}`} onClick={() => start(r)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={5}>{rows.length ? "No CMS partners match these filters." : "No CMS partners yet — add CMS A."}</EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} noun="partners" />
      </div>
    </div>
  );
}
