"use client";

import { Building, Pencil, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { useOrganization } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { StatusPill, Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { HELP } from "@/lib/help";
import { OWNER_TYPE_LABELS } from "@/lib/deals";
import type { ContentOwner, OwnerType } from "@/lib/types";
import { timeValue, useClientTable } from "@/lib/use-client-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { type FilterField, ListFilters } from "@/components/list-filters";

const SORT_BY = {
  name: (o: ContentOwner) => o.name,
  type: (o: ContentOwner) => OWNER_TYPE_LABELS[o.owner_type],
  deals: (o: ContentOwner) => o.deal_count,
  created: (o: ContentOwner) => timeValue(o.created_at),
};

type Form = {
  name: string;
  owner_type: OwnerType | "";
  contact_name: string;
  contact_email: string;
  notes: string;
  is_active: boolean;
};
const EMPTY: Form = { name: "", owner_type: "", contact_name: "", contact_email: "", notes: "", is_active: true };

export default function ContentOwnersPage() {
  const organization = useOrganization();
  const [owners, setOwners] = useState<ContentOwner[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ContentOwner[]>("/content-owners")
      .then(setOwners)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function startEdit(owner: ContentOwner | null) {
    setError(null);
    setNotice(null);
    setEditing(owner ? owner.id : "new");
    setForm(
      owner
        ? {
            name: owner.name,
            owner_type: owner.owner_type,
            contact_name: owner.contact_name ?? "",
            contact_email: owner.contact_email ?? "",
            notes: owner.notes ?? "",
            is_active: owner.is_active,
          }
        : EMPTY,
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<ContentOwner>(editing === "new" ? "/content-owners" : `/content-owners/${editing}`, {
        method: editing === "new" ? "POST" : "PUT",
        json: form,
      });
      setNotice(`${saved.name} ${editing === "new" ? "added" : "saved"}.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = owners.filter(
    (o) =>
      (!q || o.name.toLowerCase().includes(q) || (o.contact_name ?? "").toLowerCase().includes(q)) &&
      (!typeFilter || o.owner_type === typeFilter) &&
      (!statusFilter || (statusFilter === "active") === o.is_active),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: [q, typeFilter, statusFilter].join("|"),
  });

  const filterFields: FilterField[] = [
    { key: "type", label: "Type", options: [["", "All types"], ...Object.entries(OWNER_TYPE_LABELS)] },
    {
      key: "status",
      label: "Status",
      options: [
        ["", "All statuses"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content owners"
        description={`Who ${organization.name} licenses content from — Sony, other vendors, or its own IP.`}
        actions={
          <Button size="lg" onClick={() => startEdit(null)}>
            <Plus />
            New owner
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        <StatCard
          label="Content owners"
          value={owners.filter((o) => o.is_active).length}
          icon={Building}
          info={HELP.owner}
          active={!typeFilter && statusFilter === "active"}
          onClick={() => {
            setTypeFilter("");
            setStatusFilter("active");
          }}
        />
        <StatCard
          label="Deals with them"
          value={owners.reduce((sum, o) => sum + o.deal_count, 0)}
          icon={Users}
          tone="green"
          info={HELP.dealType}
          href="/deals"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} wide title={editing === "new" ? "New content owner" : `Edit ${form.name}`}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Type *</Label>
            <NativeSelect id="type" required value={form.owner_type} onChange={(e) => setForm({ ...form, owner_type: e.target.value as OwnerType })}>
              <option value="">Select…</option>
              {Object.entries(OWNER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_name">Contact person</Label>
            <Input id="contact_name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_email">Contact email</Label>
            <Input
              id="contact_email"
              type="email"
              placeholder="Used later for whitelisting emails"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active (inactive owners cannot get new deals)
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
        placeholder="Search name or contact…"
        fields={filterFields}
        values={{ type: typeFilter, status: statusFilter }}
        onChange={(key, value) => (key === "type" ? setTypeFilter(value) : setStatusFilter(value))}
        onClear={() => {
          setQuery("");
          setTypeFilter("");
          setStatusFilter("");
        }}
        total={table.total}
        noun="owners"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Owner" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Type" sortKey="type" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Contact</TableHead>
              <SortableHead label="Deals" sortKey="deals" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((o, idx) => (
              <TableRow key={o.id}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
                <TableCell className="font-semibold">{o.name}</TableCell>
                <TableCell>
                  <Tag>{OWNER_TYPE_LABELS[o.owner_type]}</Tag>
                </TableCell>
                <TableCell>
                  <p>{o.contact_name ?? "—"}</p>
                  {o.contact_email && <p className="text-muted-foreground">{o.contact_email}</p>}
                </TableCell>
                <TableCell className="font-semibold">{o.deal_count}</TableCell>
                <TableCell>
                  <StatusPill active={o.is_active} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="icon" aria-label={`Edit ${o.name}`} onClick={() => startEdit(o)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={7}>
                {owners.length === 0 ? "No content owners yet — add Sony or your first vendor." : "No owners match these filters."}
              </EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="owners"
        />
      </div>
    </div>
  );
}
