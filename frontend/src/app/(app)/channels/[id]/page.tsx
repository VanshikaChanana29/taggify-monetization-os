"use client";

import { ArrowLeft, BarChart3, ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ChannelForm } from "@/components/channel-form";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { SLOT_STATUS_LABELS, SLOT_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { PLATFORM_LABELS, PLATFORM_TONES, canManage } from "@/lib/people";
import type { ChannelDetail, Employee } from "@/lib/types";

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-2 text-lg font-bold">{children}</div>
    </div>
  );
}

const END_LABELS: Record<string, string> = { replaced: "Replaced", unassigned: "Removed" };

function period(start: string, end: string | null): string {
  return `${formatDate(start)} → ${end ? formatDate(end) : "now"}`;
}

export default function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [editing, setEditing] = useState(false);
  const [managerId, setManagerId] = useState("");
  const [effective, setEffective] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ChannelDetail>(`/channels/${id}`)
      .then((c) => {
        setChannel(c);
        setManagerId(c.manager?.id ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    load();
    api<Employee[]>("/employees").then(setPeople).catch(() => {});
  }, [load]);

  async function changeManager(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api(`/channels/${id}/manager`, {
        method: "POST",
        json: { employee_id: managerId || null, effective_date: effective || null },
      });
      setNotice(managerId ? "Manager updated." : "Manager removed.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change manager");
    }
  }

  if (!channel) return error ? <Notice kind="error">{error}</Notice> : <p className="text-muted-foreground">Loading…</p>;

  const firstSlot = channel.slots[0];
  const activePeople = people.filter(
    (p) => (p.is_active && canManage(p.role, channel.platform)) || p.id === channel.manager?.id,
  );

  return (
    <div className="space-y-8">
      <Link href="/channels" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All channels
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{channel.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill tone={PLATFORM_TONES[channel.platform]}>{PLATFORM_LABELS[channel.platform]}</Pill>
            <StatusPill active={channel.status === "active"} />
            <span className="font-mono text-sm text-muted-foreground">{channel.external_id}</span>
            {channel.url && (
              <a href={channel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
        <Button size="lg" variant="outline" onClick={() => setEditing((v) => !v)}>
          <Pencil />
          Edit channel
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {editing && (
        <ChannelForm
          channel={channel}
          notes={channel.notes}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice("Channel saved.");
            load();
          }}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <InfoCard label="CMS">{channel.cms_name ?? "—"}</InfoCard>
        <InfoCard label="Deal">
          {firstSlot ? (
            <Link href={`/deals/${firstSlot.deal_id}`} className="hover:text-primary">
              {firstSlot.owner_name} / {firstSlot.deal_title}
            </Link>
          ) : (
            "No deal"
          )}
        </InfoCard>
        <InfoCard label="Employee">
          {channel.manager ? (
            <Link href={`/people/${channel.manager.id}`} className="hover:text-primary">
              {channel.manager.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoCard>
        <InfoCard label="Team lead">
          {channel.team_lead ? (
            <Link href={`/people/${channel.team_lead.id}`} className="hover:text-primary">
              {channel.team_lead.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoCard>
        <InfoCard label="Rights slot">
          {channel.slots.length ? channel.slots.map((s) => <span key={s.slot_id} className="mr-2 font-mono">{s.slot_code}</span>) : "—"}
        </InfoCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="p-6 pb-4">
              <h3 className="text-lg font-semibold">Deal slots</h3>
              <p className="text-sm text-muted-foreground">Every slot this channel has held. Assign or replace from the deal page.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>How it ended</TableHead>
                  <TableHead>Now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channel.slot_history.map((h) => {
                  const current = channel.slots.find((s) => s.slot_id === h.slot_id && !h.end_date);
                  return (
                    <TableRow key={h.id}>
                      <TableCell>
                        <Link href={`/deals/${h.deal_id}`} className="font-medium hover:text-primary">
                          {h.deal_title}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono font-semibold">{h.slot_code}</TableCell>
                      <TableCell className="whitespace-nowrap">{period(h.start_date, h.end_date)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {h.end_reason ? END_LABELS[h.end_reason] : "—"}
                        {h.notes && <span className="block text-xs">{h.notes}</span>}
                      </TableCell>
                      <TableCell>
                        {current && <Pill tone={SLOT_STATUS_TONES[current.slot_status]}>{SLOT_STATUS_LABELS[current.slot_status]}</Pill>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {channel.slot_history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Not in any deal slot yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-2xl border border-dashed bg-card p-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Views, revenue and RPM</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Synced from YouTube / Meta in Part 6 (CSV import arrives first, in Part 4), with the source and last sync time for every number.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Manager</h3>
            <p className="text-sm text-muted-foreground">
              Only people whose role can manage {PLATFORM_LABELS[channel.platform]} {channel.platform === "youtube" ? "channels" : "pages"} are listed (
              <Link href="/settings/roles" className="text-primary hover:underline">
                Roles
              </Link>
              ). Handing over keeps the history.
            </p>
            <form onSubmit={changeManager} className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="mgr">Manager</Label>
                <NativeSelect id="mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">No manager</option>
                  {activePeople.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} · {p.role.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mgr-date">From date</Label>
                <Input id="mgr-date" type="date" max={todayISO()} value={effective} onChange={(e) => setEffective(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={managerId === (channel.manager?.id ?? "")}>
                Save
              </Button>
            </form>
            <ul className="mt-6 space-y-3 border-t pt-4 text-sm">
              {channel.manager_history.map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <Link href={`/people/${m.employee.id}`} className="font-medium hover:text-primary">
                    {m.employee.name}
                  </Link>
                  <span className="text-right text-muted-foreground">{period(m.start_date, m.end_date)}</span>
                </li>
              ))}
              {channel.manager_history.length === 0 && <li className="text-muted-foreground">No manager yet.</li>}
            </ul>
          </section>
          {channel.notes && (
            <section className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Notes</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{channel.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
