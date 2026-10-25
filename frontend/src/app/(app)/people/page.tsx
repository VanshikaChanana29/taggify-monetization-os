"use client";

import { Crown, Plus, Tv, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { EmployeeForm } from "@/components/employee-form";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people-tabs";
import { useOrganization } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { StatusPill, Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { HELP } from "@/lib/help";
import { formatMoney } from "@/lib/deals";
import type { ChannelsSummary, Employee, RoleWithCount, Team } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";
import { Dialog } from "@/components/ui/dialog";
import { type FilterField, ListFilters } from "@/components/list-filters";

const SORT_BY = {
  name: (e: Employee) => e.full_name,
  role: (e: Employee) => e.role.name,
  team: (e: Employee) => e.team?.name ?? null,
  lead: (e: Employee) => e.team_lead?.name ?? null,
  channels: (e: Employee) => e.channel_count,
  pay: (e: Employee) => (e.monthly_salary ? Number(e.monthly_salary) : null),
  incentive: (e: Employee) => Number(e.manager_rate ?? e.team_lead_rate ?? -1),
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
    api<RoleWithCount[]>("/employee-roles")
      .then(setRoles)
      .catch(() => {});
    api<Team[]>("/teams")
      .then(setTeams)
      .catch(() => {});
    api<ChannelsSummary>("/channels/summary")
      .then(setSummary)
      .catch(() => {});
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

  const filterFields: FilterField[] = [
    { key: "role", label: "Role", options: [["", "All roles"], ...roles.map((r): [string, string] => [r.id, r.name])] },
    { key: "team", label: "Team", options: [["", "All teams"], ...teams.map((t): [string, string] => [t.id, t.name]), ["none", "No team"]] },
    {
      key: "status",
      label: "Status",
      options: [
        ["", "Everyone"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    },
  ];

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
        <StatCard
          label="Active people"
          value={active.length}
          icon={Users}
          info="Your team members. They do not log in — founders keep their records here."
          active={status === "active" && !role && !team}
          onClick={() => {
            setStatus("active");
            setRole("");
            setTeam("");
          }}
        />
        <StatCard label="Teams" value={teams.filter((t) => t.is_active).length} icon={Crown} tone="amber" info={HELP.team} href="/people/teams" />
        <StatCard
          label="Channels managed"
          value={active.reduce((n, p) => n + p.channel_count, 0)}
          icon={Tv}
          tone="green"
          info={HELP.manager}
          href="/channels?managed=yes&status=active"
        />
        <StatCard
          label="Channels without manager"
          value={summary?.without_manager ?? "—"}
          icon={Tv}
          tone="amber"
          info="Nobody earns an incentive on these channels and nobody is accountable for them."
          href="/channels?managed=no&status=active"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <Dialog open={adding} onClose={() => setAdding(false)} wide title="Add a person">
        {adding && (
          <EmployeeForm
            inDialog
            employee={null}
            onCancel={() => setAdding(false)}
            onSaved={(saved) => {
              setAdding(false);
              setNotice(`${saved.full_name} added.`);
              load();
            }}
          />
        )}
      </Dialog>

      <ListFilters
        search={query}
        onSearch={setQuery}
        placeholder="Search name or email…"
        fields={filterFields}
        values={{ role, team, status }}
        onChange={(key, value) => (key === "role" ? setRole(value) : key === "team" ? setTeam(value) : setStatus(value))}
        onClear={() => {
          setQuery("");
          setRole("");
          setTeam("");
          setStatus("active");
        }}
        total={table.total}
        noun="people"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Person" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Role" sortKey="role" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Team" sortKey="team" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Team lead" sortKey="lead" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Channels" sortKey="channels" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Fixed pay / mo" sortKey="pay" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Gross incentive" sortKey="incentive" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((e, idx) => (
              <TableRow key={e.id}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
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
                <TableCell className="max-w-56">
                  {e.channel_count ? (
                    <span title={e.channel_names.join(", ")}>
                      <span className="font-semibold">{e.channel_count}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.channel_names.join(", ")}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatMoney(e.monthly_salary, e.salary_currency)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {e.manager_rate || e.team_lead_rate ? (
                    <>
                      {e.manager_rate && <span className="block">{Number(e.manager_rate)}% of gross</span>}
                      {e.team_lead_rate && <span className="block text-xs text-muted-foreground">{Number(e.team_lead_rate)}% on team</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill active={e.is_active} />
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={9}>{people.length ? "Nobody matches these filters." : "No people yet — add your team."}</EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="people"
        />
      </div>
    </div>
  );
}
