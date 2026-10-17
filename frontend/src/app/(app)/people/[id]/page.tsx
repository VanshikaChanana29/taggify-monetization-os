"use client";

import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmployeeForm } from "@/components/employee-form";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { StatusPill, Tag } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/deals";
import { PLATFORM_LABELS, PLATFORM_TONES, roleAbilities } from "@/lib/people";
import type { EmployeeDetail } from "@/lib/types";

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-2 text-lg font-bold">{children}</div>
    </div>
  );
}

function period(start: string, end: string | null) {
  return `${formatDate(start)} → ${end ? formatDate(end) : "now"}`;
}

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<EmployeeDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<EmployeeDetail>(`/employees/${id}`)
      .then(setPerson)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (!person) return error ? <Notice kind="error">{error}</Notice> : <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <Link href="/people" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All people
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={person.full_name} seed={person.id} className="h-14 w-14 text-lg" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{person.full_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Tag>{person.role.name}</Tag>
              <StatusPill active={person.is_active} />
              <span className="text-xs text-muted-foreground">{roleAbilities(person.role)}</span>
            </div>
          </div>
        </div>
        <Button size="lg" variant="outline" onClick={() => setEditing((v) => !v)}>
          <Pencil />
          Edit
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {editing && (
        <EmployeeForm
          employee={person}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice("Saved.");
            load();
          }}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <InfoCard label="Team">
          {person.team ? (
            <Link href={`/people/teams/${person.team.id}`} className="hover:text-primary">
              {person.team.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoCard>
        <InfoCard label="Team lead">
          {person.team_lead ? (
            <Link href={`/people/${person.team_lead.id}`} className="hover:text-primary">
              {person.team_lead.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoCard>
        <InfoCard label="Channels now">{person.channel_count}</InfoCard>
        <InfoCard label="Fixed pay / mo">{formatMoney(person.monthly_salary, person.salary_currency)}</InfoCard>
        <InfoCard label="Joined">{person.join_date ? formatDate(person.join_date) : "—"}</InfoCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="p-6 pb-4">
              <h3 className="text-lg font-semibold">Handling now</h3>
              <p className="text-sm text-muted-foreground">Revenue and incentives per channel arrive in Part 4.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Deal · slot</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {person.channels.map((c) => (
                  <TableRow key={c.channel_id}>
                    <TableCell>
                      <Link href={`/channels/${c.channel_id}`} className="font-semibold hover:text-primary">
                        {c.channel_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                    </TableCell>
                    <TableCell>{c.deals.length ? c.deals.join(", ") : <span className="text-muted-foreground">No slot</span>}</TableCell>
                    <TableCell>{formatDate(c.since)}</TableCell>
                  </TableRow>
                ))}
                {person.channels.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Not managing any channel. Assign one from a channel page.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Channel history</h3>
            <ul className="mt-4 space-y-2 text-sm">
              {person.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 border-l-2 border-primary/40 pl-4">
                  <Link href={`/channels/${h.channel_id}`} className="font-medium hover:text-primary">
                    {h.channel_name}
                  </Link>
                  <span className="text-muted-foreground">{period(h.start_date, h.end_date)}</span>
                </li>
              ))}
              {person.history.length === 0 && <li className="text-muted-foreground">No history yet.</li>}
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          {person.leads_teams.length > 0 && (
            <section className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Leads</h3>
              <p className="text-sm text-muted-foreground">
                {person.leads_teams.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && ", "}
                    <Link href={`/people/teams/${t.id}`} className="text-primary hover:underline">
                      {t.name}
                    </Link>
                  </span>
                ))}
              </p>
              <ul className="mt-4 space-y-3">
                {person.team_members.map((m) => (
                  <li key={m.id}>
                    <Link href={`/people/${m.id}`} className="flex items-center gap-3 text-sm font-medium hover:text-primary">
                      <UserAvatar name={m.name} seed={m.id} className="h-8 w-8 text-xs" />
                      {m.name}
                    </Link>
                  </li>
                ))}
                {person.team_members.length === 0 && <li className="text-sm text-muted-foreground">No members yet.</li>}
              </ul>
            </section>
          )}
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Team history</h3>
            <ul className="mt-4 space-y-2 text-sm">
              {person.team_history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <Link href={`/people/teams/${h.team.id}`} className="font-medium hover:text-primary">
                    {h.team.name}
                  </Link>
                  <span className="text-right text-muted-foreground">{period(h.start_date, h.end_date)}</span>
                </li>
              ))}
              {person.team_history.length === 0 && <li className="text-muted-foreground">Not in a team yet.</li>}
            </ul>
          </section>
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Contact</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{person.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{person.phone ?? "—"}</dd>
              </div>
              {person.notes && <p className="border-t pt-2 text-muted-foreground">{person.notes}</p>}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
