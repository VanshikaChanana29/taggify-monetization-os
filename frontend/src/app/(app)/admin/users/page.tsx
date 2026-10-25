"use client";

import { Crown, KeyRound, UserCheck, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PasswordInput } from "@/components/password-input";
import { useSession } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { StatusPill, Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AdminMembership, AdminOrganization, AdminUser } from "@/lib/types";
import { timeValue, useClientTable } from "@/lib/use-client-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { type FilterField, ListFilters } from "@/components/list-filters";

const activeCompanies = (u: AdminUser) => u.memberships.filter((m) => m.is_active).length;

const SORT_BY = {
  name: (u: AdminUser) => u.full_name,
  access: (u: AdminUser) => activeCompanies(u),
  last_login: (u: AdminUser) => timeValue(u.last_login_at),
};

type Status = "" | "active" | "no_access";
type Role = "" | "superadmin" | "founder";

const EMPTY_FORM = { full_name: "", email: "", password: "", organization_id: "" };

export default function AllUsersPage() {
  const { me } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<AdminOrganization[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [role, setRole] = useState<Role>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api<AdminUser[]>("/admin/users"), api<AdminOrganization[]>("/admin/organizations")])
      .then(([u, c]) => {
        setUsers(u);
        setCompanies(c);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function createUser(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      await api("/admin/users", { method: "POST", json: form });
      setForm(EMPTY_FORM);
      setShowForm(false);
    }, `${form.full_name} created. Share the temporary password with them privately.`);
  }

  function toggleMembership(user: AdminUser, m: AdminMembership) {
    const action = m.is_active ? "deactivate" : "activate";
    if (m.is_active && !window.confirm(`Remove ${user.full_name}'s access to ${m.organization_name}?`)) {
      return;
    }
    run(
      () =>
        api(`/admin/users/${user.id}/memberships/${m.organization_id}/${action}`, {
          method: "POST",
        }),
      `${user.full_name} ${m.is_active ? "removed from" : "restored to"} ${m.organization_name}.`,
    );
  }

  function addToCompany(user: AdminUser, organizationId: string) {
    const company = companies.find((c) => c.id === organizationId);
    if (!company) return;
    run(
      () =>
        api(`/admin/users/${user.id}/memberships`, {
          method: "POST",
          json: { organization_id: organizationId },
        }),
      `${user.full_name} now has access to ${company.name}.`,
    );
  }

  function resetPassword(user: AdminUser) {
    const password = window.prompt(`New temporary password for ${user.full_name} (min 10 characters):`);
    if (!password) return;
    run(
      () => api(`/admin/users/${user.id}/reset-password`, { method: "POST", json: { password } }),
      `Password reset for ${user.full_name}. They have been logged out everywhere.`,
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      (!q || u.full_name.toLowerCase().includes(q) || u.email.includes(q)) &&
      (!companyFilter || u.memberships.some((m) => m.organization_id === companyFilter)) &&
      (!status || (status === "active") === activeCompanies(u) > 0) &&
      (!role || (role === "superadmin") === u.is_superadmin),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: [q, companyFilter, status, role].join("|"),
  });
  const activeFounders = users.filter((u) => u.memberships.some((m) => m.is_active)).length;

  const filterFields: FilterField[] = [
    { key: "company", label: "Company", options: [["", "All companies"], ...companies.map((c): [string, string] => [c.id, c.name])] },
    {
      key: "status",
      label: "Status",
      options: [
        ["", "All statuses"],
        ["active", "Has access"],
        ["no_access", "No access"],
      ],
    },
    {
      key: "role",
      label: "Role",
      options: [
        ["", "All roles"],
        ["founder", "Founders"],
        ["superadmin", "Super admins"],
      ],
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="All users"
        description="Founders across every company. A founder only sees the companies listed against them."
        actions={
          <Button size="lg" onClick={() => setShowForm((v) => !v)} disabled={!companies.length}>
            <UserPlus />
            Create founder
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        <StatCard
          label="Total users"
          value={users.length}
          icon={Users}
          active={!status && !role && !companyFilter}
          onClick={() => {
            setStatus("");
            setRole("");
            setCompanyFilter("");
          }}
        />
        <StatCard
          label="Active founders"
          value={activeFounders}
          icon={UserCheck}
          tone="green"
          info="Founders who can log in to at least one company."
          active={role === "founder" && status === "active"}
          onClick={() => {
            setRole("founder");
            setStatus("active");
          }}
        />
        <StatCard
          label="Super admins"
          value={users.filter((u) => u.is_superadmin).length}
          icon={Crown}
          tone="amber"
          info="Super admins create companies and founders. They do not see business data unless also a founder."
          active={role === "superadmin"}
          onClick={() => {
            setRole("superadmin");
            setStatus("");
          }}
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <Dialog open={Boolean(showForm)} onClose={() => setShowForm(false)} wide title={"New founder"}>
        <form onSubmit={createUser} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <NativeSelect id="company" required value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })}>
              <option value="">Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Temporary password (min 10)</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            {error && <Notice kind="error">{error}</Notice>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Create founder</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <ListFilters
        search={query}
        onSearch={setQuery}
        placeholder="Search name or email…"
        fields={filterFields}
        values={{ company: companyFilter, status, role }}
        onChange={(key, value) =>
          key === "company" ? setCompanyFilter(value) : key === "status" ? setStatus(value as Status) : setRole(value as Role)
        }
        onClear={() => {
          setQuery("");
          setCompanyFilter("");
          setStatus("");
          setRole("");
        }}
        noun="users"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="User" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Company access" sortKey="access" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Last login" sortKey="last_login" sort={table.sort} onSort={table.toggleSort} />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((u, idx) => {
              const isMe = u.id === me.user.id;
              const memberOf = new Set(u.memberships.map((m) => m.organization_id));
              const addable = companies.filter((c) => !memberOf.has(c.id));
              return (
                <TableRow key={u.id} className="align-top">
                  <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-4">
                      <UserAvatar name={u.full_name} seed={u.id} />
                      <div>
                        <p className="font-semibold">
                          {u.full_name} {isMe && <span className="font-normal text-muted-foreground">(you)</span>}
                        </p>
                        <p className="text-muted-foreground">{u.email}</p>
                        {u.is_superadmin && <Tag className="mt-1">Super admin</Tag>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {u.memberships.map((m) => (
                        <div key={m.organization_id} className="flex items-center gap-3">
                          <span className="min-w-24 font-medium">{m.organization_name}</span>
                          <StatusPill active={m.is_active} label={m.is_active ? "Active" : "Removed"} />
                          {!(isMe && m.is_active) && (
                            <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => toggleMembership(u, m)}>
                              {m.is_active ? "Remove" : "Restore"}
                            </button>
                          )}
                        </div>
                      ))}
                      {u.memberships.length === 0 && <p className="text-muted-foreground">No company access</p>}
                      {addable.length > 0 && (
                        <NativeSelect
                          aria-label={`Add ${u.full_name} to a company`}
                          className="h-9 w-52"
                          value=""
                          onChange={(e) => addToCompany(u, e.target.value)}
                        >
                          <option value="">+ Add to company…</option>
                          {addable.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(u.last_login_at)}</TableCell>
                  <TableCell className="text-right">
                    {!isMe && (
                      <Button
                        variant="outline"
                        size="icon"
                        title="Reset password"
                        aria-label={`Reset password for ${u.full_name}`}
                        className="border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-500/30"
                        onClick={() => resetPassword(u)}
                      >
                        <KeyRound />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {table.total === 0 && <EmptyRow colSpan={5}>No users match these filters.</EmptyRow>}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="users"
        />
      </div>
    </div>
  );
}
