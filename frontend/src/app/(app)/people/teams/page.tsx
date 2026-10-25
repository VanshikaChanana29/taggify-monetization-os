"use client";

import { Plus, Tv, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people-tabs";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { HELP } from "@/lib/help";
import type { Employee, Team } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { ListFilters } from "@/components/list-filters";

const SORT_BY = {
  name: (t: Team) => t.name,
  lead: (t: Team) => t.lead?.name ?? null,
  members: (t: Team) => t.member_count,
  channels: (t: Team) => t.channel_count,
};

export default function TeamsPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [leadId, setLeadId] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Team[]>("/teams")
      .then(setTeams)
      .catch((err: Error) => setError(err.message));
    api<Employee[]>("/employees")
      .then(setPeople)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const leaders = people.filter((p) => p.is_active && p.role.can_lead_team);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<Team>("/teams", {
        method: "POST",
        json: { name, description: description || null, lead_id: leadId || null },
      });
      router.push(`/people/teams/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the team");
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = teams.filter(
    (t) =>
      (!q || t.name.toLowerCase().includes(q) || (t.lead?.name ?? "").toLowerCase().includes(q)) &&
      (!status || (status === "active") === t.is_active),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: `${q}|${status}`,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Teams"
        description="Groups of people under one team lead. The lead earns the team-lead incentive on the team's channels (Part 4)."
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus />
            New team
          </Button>
        }
      />
      <PeopleTabs />

      <div className="grid gap-5 md:grid-cols-3">
        <StatCard
          label="Active teams"
          value={teams.filter((t) => t.is_active).length}
          icon={UsersRound}
          info={HELP.team}
          active={status === "active"}
          onClick={() => setStatus("active")}
        />
        <StatCard label="People in teams" value={teams.reduce((n, t) => n + t.member_count, 0)} icon={Users} tone="green" href="/people" />
        <StatCard
          label="Channels handled by teams"
          value={teams.reduce((n, t) => n + t.channel_count, 0)}
          icon={Tv}
          tone="slate"
          info="Channels managed by someone who is in a team — the team lead earns a % on them."
          href="/channels?managed=yes&status=active"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <Dialog open={Boolean(creating)} onClose={() => setCreating(false)} wide title={"New team"}>
        <form onSubmit={create} className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="team-name">Name *</Label>
            <Input id="team-name" required autoFocus placeholder="e.g. Kapil Team" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-lead">Team lead</Label>
            <NativeSelect id="team-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Choose later</option>
              {leaders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.role.name}
                </option>
              ))}
            </NativeSelect>
            {leaders.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nobody&apos;s role can lead a team yet. Tick &quot;Leads a team&quot; on a role under{" "}
                <Link href="/settings/roles" className="text-primary hover:underline">
                  Roles
                </Link>
                .
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-desc">Description</Label>
            <Input id="team-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground md:col-span-3">Add members by choosing this team on each person.</p>
          <div className="md:col-span-3">
            {error && <Notice kind="error">{error}</Notice>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit">Create team</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <ListFilters
        search={query}
        onSearch={setQuery}
        placeholder="Search team or lead…"
        fields={[
          {
            key: "status",
            label: "Status",
            options: [
              ["", "All teams"],
              ["active", "Active"],
              ["inactive", "Inactive"],
            ],
          },
        ]}
        values={{ status }}
        onChange={(_, value) => setStatus(value)}
        onClear={() => {
          setQuery("");
          setStatus("active");
        }}
        total={table.total}
        noun="teams"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Team" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Team lead" sortKey="lead" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Members" sortKey="members" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Channels" sortKey="channels" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((t, idx) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/people/teams/${t.id}`)}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(table.page - 1) * table.pageSize + idx + 1}</TableCell>
                <TableCell>
                  <p className="font-semibold">{t.name}</p>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                </TableCell>
                <TableCell>{t.lead?.name ?? <span className="text-amber-600">No lead</span>}</TableCell>
                <TableCell className="font-semibold">{t.member_count}</TableCell>
                <TableCell className="font-semibold">{t.channel_count}</TableCell>
                <TableCell>
                  <StatusPill active={t.is_active} />
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && (
              <EmptyRow colSpan={6}>{teams.length ? "No teams match these filters." : "No teams yet — create the first one."}</EmptyRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="teams"
        />
      </div>
    </div>
  );
}
