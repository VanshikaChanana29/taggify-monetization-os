"use client";

import { Crown, Plus, Tv, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, FilterBar, SearchInput, SortableHead, TablePagination } from "@/components/data-table";
import { EmployeeForm } from "@/components/employee-form";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people-tabs";
import { useOrganization } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { StatusPill, Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/deals";
import type { ChannelsSummary, Employee, RoleWithCount, Team } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";

const SORT_BY = {
  name: (e: Employee) => e.full_name,
  role: (e: Employee) => e.role.name,
  team: (e: Employee) => e.team?.name ?? null,
  lead: (e: Employee) => e.team_lead?.name ?? null,
  channels: (e: Employee) => e.channel_count,
  pay: (e: Employee) => (e.monthly_salary ? Number(e.monthly_salary) : null),
};

export default function PeoplePage() {
  const organization = useOrganization();
  const [people, setPeople] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<RoleWithCount[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [summary, setSummary] = useState<ChannelsSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Employee[]>("/employees")
      .then(setPeople)
      .catch((err: Error) => setError(err.message));
    api<RoleWithCount[]>("/employee-roles").then(setRoles).catch(() => {});
    api<Team[]>("/teams").then(setTeams).catch(() => {});
    api<ChannelsSummary>("/channels/summary").then(setSummary).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const q = query.trim().toLowerCase();
  const filtered = people.filter(
    (e) =>
      (!q || e.full_name.toLowerCase().includes(q) || (e.email ?? "").toLowerCase().includes(q)) &&
      (!role || e.role.id === role) &&
      (!team || (team === "none" ? !e.team : e.team?.id === team || e.leads_teams.some((t) => t.id === team))) &&
      (!status || (status === "active") === e.is_active),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: [q, role, team, status].join("|"),
  });
  const active = people.filter((p) => p.is_active);

  return (
    <div className="space-y-8">
      <PageHeader
        title="People"
        description={`${organization.name}'s team: roles, teams and who handles which channel. Employees do not log in.`}
        actions={
          <Button size="lg" onClick={() => setAdding(true)}>
            <Plus />
            Add person
          </Button>
        }
      />
      <PeopleTabs />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active people" value={active.length} icon={Users} />
        <StatCard label="Teams" value={teams.filter((t) => t.is_active).length} icon={Crown} tone="amber" />
        <StatCard label="Channels managed" value={active.reduce((n, p) => n + p.channel_count, 0)} icon={Tv} tone="green" />
        <StatCard label="Channels without manager" value={summary?.without_manager ?? "—"} icon={Tv} tone="amber" />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {adding && (
        <EmployeeForm
          employee={null}
          onCancel={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            setNotice(`${saved.full_name} added.`);
            load();
          }}
        />
      )}

      <FilterBar
        active={Boolean(q || role || team || status !== "active")}
        onClear={() => {
          setQuery("");
          setRole("");
          setTeam("");
          setStatus("active");
        }}
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search name or email…" />
        <NativeSelect aria-label="Filter by role" className="w-48" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by team" className="w-48" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="none">No team</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everyone</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Person" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Role" sortKey="role" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Team" sortKey="team" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Team lead" sortKey="lead" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Channels" sortKey="channels" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Fixed pay / mo" sortKey="pay" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link href={`/people/${e.id}`} className="flex items-center gap-4 hover:text-primary">
                    <UserAvatar name={e.full_name} seed={e.id} />
                    <div>
                      <p className="font-semibold">{e.full_name}</p>
                      <p className="text-muted-foreground">{e.email ?? "—"}</p>
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  <Tag>{e.role.name}</Tag>
                </TableCell>
                <TableCell>
                  {e.team ? (
                    <Link href={`/people/teams/${e.team.id}`} className="hover:text-primary">
                      {e.team.name}
                    </Link>
                  ) : e.leads_teams.length ? (
                    <span className="text-muted-foreground">Leads {e.leads_teams.map((t) => t.name).join(", ")}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{e.team_lead?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-semibold">{e.channel_count}</TableCell>
                <TableCell className="whitespace-nowrap">{formatMoney(e.monthly_salary, e.salary_currency)}</TableCell>
                <TableCell>
                  <StatusPill active={e.is_active} />
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={7}>{people.length ? "Nobody matches these filters." : "No people yet — add your team."}</EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} noun="people" />
      </div>
    </div>
  );
}
