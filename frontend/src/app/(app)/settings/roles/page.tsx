"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { RoleWithCount } from "@/lib/types";

type Form = { name: string; can_manage_youtube: boolean; can_manage_facebook: boolean; can_lead_team: boolean };
const EMPTY: Form = { name: "", can_manage_youtube: false, can_manage_facebook: false, can_lead_team: false };

const FLAGS: [keyof Omit<Form, "name">, string, string][] = [
  ["can_manage_youtube", "Manages YouTube channels", "Can be chosen as manager of a YouTube channel"],
  ["can_manage_facebook", "Manages Facebook pages", "Can be chosen as manager of a Facebook page"],
  ["can_lead_team", "Leads a team", "Can be a team lead (earns the lead incentive in Part 4)"],
];

function Yes({ on }: { on: boolean }) {
  return on ? <Check className="h-5 w-5 text-emerald-600" /> : <span className="text-muted-foreground">—</span>;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleWithCount[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<RoleWithCount[]>("/employee-roles")
      .then(setRoles)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function start(role: RoleWithCount | null) {
    setError(null);
    setNotice(null);
    setEditing(role ? role.id : "new");
    setForm(role ? { name: role.name, can_manage_youtube: role.can_manage_youtube, can_manage_facebook: role.can_manage_facebook, can_lead_team: role.can_lead_team } : EMPTY);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<RoleWithCount>(editing === "new" ? "/employee-roles" : `/employee-roles/${editing}`, {
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

  async function remove(role: RoleWithCount) {
    if (!window.confirm(`Delete the role ${role.name}?`)) return;
    setError(null);
    try {
      await api(`/employee-roles/${role.id}`, { method: "DELETE" });
      setNotice(`${role.name} deleted.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Roles"
        description="Your own job roles. What a role is allowed to do decides who appears in the channel Manager and Team lead lists."
        actions={
          <Button size="lg" onClick={() => start(null)}>
            <Plus />
            New role
          </Button>
        }
      />
      <PeopleTabs />

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {editing && (
        <form onSubmit={save} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">{editing === "new" ? "New role" : `Edit ${form.name}`}</h3>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="role-name">Name *</Label>
            <Input id="role-name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {FLAGS.map(([key, label, hint]) => (
              <label key={key} className="flex cursor-pointer gap-3 rounded-xl border p-4 hover:border-primary">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>YouTube channels</TableHead>
              <TableHead>Facebook pages</TableHead>
              <TableHead>Leads a team</TableHead>
              <TableHead>People</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">{r.name}</TableCell>
                <TableCell><Yes on={r.can_manage_youtube} /></TableCell>
                <TableCell><Yes on={r.can_manage_facebook} /></TableCell>
                <TableCell><Yes on={r.can_lead_team} /></TableCell>
                <TableCell className="font-semibold">{r.people_count}</TableCell>
                <TableCell className="space-x-2 whitespace-nowrap text-right">
                  <Button variant="outline" size="icon" aria-label={`Edit ${r.name}`} onClick={() => start(r)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Delete ${r.name}`}
                    disabled={r.people_count > 0}
                    title={r.people_count > 0 ? "Give these people another role first" : "Delete"}
                    onClick={() => remove(r)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {roles.length === 0 && <EmptyRow colSpan={6}>No roles yet.</EmptyRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
