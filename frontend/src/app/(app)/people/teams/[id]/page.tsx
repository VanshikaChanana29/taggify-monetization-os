"use client";

import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/deals";
import type { Employee, TeamDetail, TeamHistoryItem } from "@/lib/types";

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-2 text-lg font-bold">{children}</div>
    </div>
  );
}

function History({ title, rows }: { title: string; rows: TeamHistoryItem[] }) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="mt-4 space-y-2 text-sm">
        {rows.map((h) => (
          <li key={h.id} className="flex justify-between gap-3 border-l-2 border-primary/40 pl-4">
            <Link href={`/people/${h.person.id}`} className="font-medium hover:text-primary">
              {h.person.name}
            </Link>
            <span className="text-muted-foreground">
              {formatDate(h.start_date)} → {h.end_date ? formatDate(h.end_date) : "now"}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
      </ul>
    </section>
  );
}

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [leadId, setLeadId] = useState("");
  const [effective, setEffective] = useState(todayISO());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", is_active: true });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TeamDetail>(`/teams/${id}`)
      .then((t) => {
        setTeam(t);
        setLeadId(t.lead?.id ?? "");
        setForm({ name: t.name, description: t.description ?? "", is_active: t.is_active });
      })
      .catch((err: Error) => setError(err.message));
    api<Employee[]>("/employees").then(setPeople).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (!team) return error ? <Notice kind="error">{error}</Notice> : <p className="text-muted-foreground">Loading…</p>;

  const leaders = people.filter((p) => (p.is_active && p.role.can_lead_team) || p.id === team.lead?.id);

  return (
    <div className="space-y-8">
      <Link href="/people/teams" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All teams
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill active={team.is_active} />
            {team.description && <span className="text-sm text-muted-foreground">{team.description}</span>}
          </div>
        </div>
        <Button size="lg" variant="outline" onClick={() => setEditing((v) => !v)}>
          <Pencil />
          Edit team
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {editing && (
        <form
          className="grid gap-4 rounded-2xl border bg-card p-6 shadow-sm md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api(`/teams/${team.id}`, { method: "PUT", json: { ...form, description: form.description || null } });
              setEditing(false);
            }, "Team saved.");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="t-name">Name *</Label>
            <Input id="t-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-desc">Description</Label>
            <Input id="t-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active (a team with members cannot be deactivated)
          </label>
          <div className="flex gap-3 md:col-span-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <InfoCard label="Team lead">
          {team.lead ? (
            <Link href={`/people/${team.lead.id}`} className="hover:text-primary">
              {team.lead.name}
            </Link>
          ) : (
            <span className="text-amber-600">No lead</span>
          )}
        </InfoCard>
        <InfoCard label="Members">{team.member_count}</InfoCard>
        <InfoCard label="Channels handled">{team.channel_count}</InfoCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Members</h3>
            <p className="text-sm text-muted-foreground">Add or move people by choosing their team on the person&apos;s page.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {team.members.map((m) => (
                <li key={m.id}>
                  <Link href={`/people/${m.id}`} className="flex items-center gap-3 rounded-xl border p-3 text-sm font-medium hover:border-primary">
                    <UserAvatar name={m.name} seed={m.id} className="h-9 w-9 text-xs" />
                    {m.name}
                  </Link>
                </li>
              ))}
              {team.members.length === 0 && <li className="text-sm text-muted-foreground">No members yet.</li>}
            </ul>
          </section>
          <History title="Membership history" rows={team.member_history} />
        </div>
        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Change team lead</h3>
            <p className="text-sm text-muted-foreground">Only people whose role can lead a team are listed.</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => api(`/teams/${team.id}/lead`, { method: "POST", json: { employee_id: leadId || null, effective_date: effective } }),
                  leadId ? "Team lead updated." : "Team lead removed.",
                );
              }}
            >
              <NativeSelect aria-label="Team lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">No lead</option>
                {leaders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} · {p.role.name}
                  </option>
                ))}
              </NativeSelect>
              <div className="space-y-1">
                <Label htmlFor="lead-date">From date</Label>
                <Input id="lead-date" type="date" max={todayISO()} value={effective} onChange={(e) => setEffective(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={leadId === (team.lead?.id ?? "")}>
                Save
              </Button>
            </form>
          </section>
          <History title="Lead history" rows={team.lead_history} />
        </div>
      </div>
    </div>
  );
}
