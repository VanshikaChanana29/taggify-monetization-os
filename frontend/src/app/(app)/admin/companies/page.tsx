"use client";

import { Building2, Plus, Trash2, UserX, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { DeleteCompanyDialog } from "@/components/delete-company-dialog";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AdminOrganization } from "@/lib/types";
import { timeValue, useClientTable } from "@/lib/use-client-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { ListFilters } from "@/components/list-filters";

const SORT_BY = {
  name: (c: AdminOrganization) => c.name,
  slug: (c: AdminOrganization) => c.slug,
  currency: (c: AdminOrganization) => c.base_currency,
  founders: (c: AdminOrganization) => c.active_users,
  created: (c: AdminOrganization) => timeValue(c.created_at),
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<AdminOrganization[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [currency, setCurrency] = useState("INR");
  const [query, setQuery] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminOrganization | null>(null);

  const load = useCallback(() => {
    api<AdminOrganization[]>("/admin/organizations")
      .then(setCompanies)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api<AdminOrganization>("/admin/organizations", {
        method: "POST",
        json: { name, slug, base_currency: currency },
      });
      setNotice(`${created.name} created. Now add its founders under All users.`);
      setName("");
      setSlug("");
      setSlugEdited(false);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create company");
    }
  }

  const totalFounders = companies.reduce((sum, c) => sum + c.active_users, 0);
  const q = query.trim().toLowerCase();
  const filtered = companies.filter(
    (c) => (!q || c.name.toLowerCase().includes(q) || c.slug.includes(q)) && (!currencyFilter || c.base_currency === currencyFilter),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: `${q}|${currencyFilter}`,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Companies"
        description="Each company has its own founders and completely separate data."
        actions={
          <Button size="lg" onClick={() => setShowForm((v) => !v)}>
            <Plus />
            New company
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        <StatCard
          label="Companies"
          value={companies.length}
          icon={Building2}
          info="Each company's data is separate; founders only see the companies they are given."
        />
        <StatCard label="Active founders" value={totalFounders} icon={Users} tone="green" href="/admin/users" />
        <StatCard
          label="Without founders"
          value={companies.filter((c) => c.active_users === 0).length}
          icon={UserX}
          tone="amber"
          info="Nobody can work in these companies yet — add a founder under All users."
          href="/admin/users"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <Dialog open={Boolean(showForm)} onClose={() => setShowForm(false)} wide title={"New company"}>
        <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">Company name</Label>
            <Input
              id="name"
              required
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (permanent id)</Label>
            <Input
              id="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="lowercase letters, numbers and dashes"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">Base currency</Label>
            <NativeSelect id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
            </NativeSelect>
          </div>
          <div className="md:col-span-4">
            {error && <Notice kind="error">{error}</Notice>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Create company</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <DeleteCompanyDialog
        company={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(deleted) => {
          setDeleting(null);
          setNotice(`${deleted} and all of its data were deleted.`);
          load();
        }}
      />

      <ListFilters
        search={query}
        onSearch={setQuery}
        placeholder="Search name or slug…"
        fields={[
          {
            key: "currency",
            label: "Currency",
            options: [
              ["", "All currencies"],
              ["INR", "INR"],
              ["USD", "USD"],
            ],
          },
        ]}
        values={{ currency: currencyFilter }}
        onChange={(_, value) => setCurrencyFilter(value)}
        onClear={() => {
          setQuery("");
          setCurrencyFilter("");
        }}
        total={table.total}
        noun="companies"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Company" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Slug" sortKey="slug" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Currency" sortKey="currency" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Active founders" sortKey="founders" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Created" sortKey="created" sort={table.sort} onSort={table.toggleSort} />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((c, idx) => (
              <TableRow key={c.id}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-500 dark:bg-orange-500/10">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <span className="font-semibold">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{c.slug}</TableCell>
                <TableCell>
                  <Tag>{c.base_currency}</Tag>
                </TableCell>
                <TableCell className="font-semibold">{c.active_users}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(c.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
                    onClick={() => {
                      setNotice(null);
                      setDeleting(c);
                    }}
                  >
                    <Trash2 /> Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={7}>
                {companies.length === 0 ? "No companies yet — create the first one." : "No companies match these filters."}
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
          noun="companies"
        />
      </div>
    </div>
  );
}
