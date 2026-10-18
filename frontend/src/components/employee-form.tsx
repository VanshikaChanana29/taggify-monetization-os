"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/deals";
import { roleAbilities } from "@/lib/people";
import type { Employee, RoleWithCount, Team } from "@/lib/types";

type Form = {
  full_name: string;
  role_id: string;
  team_id: string;
  team_effective_date: string;
  email: string;
  phone: string;
  join_date: string;
  monthly_salary: string;
  salary_currency: string;
  is_active: boolean;
  notes: string;
};

function fromEmployee(e: Employee | null): Form {
  return {
    full_name: e?.full_name ?? "",
    role_id: e?.role.id ?? "",
    team_id: e?.team?.id ?? "",
    team_effective_date: todayISO(),
    email: e?.email ?? "",
    phone: e?.phone ?? "",
    join_date: e?.join_date ?? "",
    monthly_salary: e?.monthly_salary ? String(Number(e.monthly_salary)) : "",
    salary_currency: e?.salary_currency ?? "INR",
    is_active: e?.is_active ?? true,
    notes: e?.notes ?? "",
  };
}

/** Add (employee = null) or edit a person. Roles and teams come from what founders set up. */
export function EmployeeForm({
  employee,
  onSaved,
  onCancel,
}: {
  employee: Employee | null;
  onSaved: (saved: Employee) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Form>(() => fromEmployee(employee));
  const [roles, setRoles] = useState<RoleWithCount[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));

  useEffect(() => {
    api<RoleWithCount[]>("/employee-roles").then(setRoles).catch(() => {});
    api<Team[]>("/teams").then(setTeams).catch(() => {});
  }, []);

  const teamChanged = (employee?.team?.id ?? "") !== form.team_id;
  const role = roles.find((r) => r.id === form.role_id);
  const teamOptions = teams.filter((t) => t.is_active || t.id === employee?.team?.id);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<Employee>(employee ? `/employees/${employee.id}` : "/employees", {
        method: employee ? "PUT" : "POST",
        json: {
          ...form,
          team_id: form.team_id || null,
          team_effective_date: teamChanged ? form.team_effective_date || null : null,
          email: form.email || null,
          phone: form.phone || null,
          join_date: form.join_date || null,
          monthly_salary: form.monthly_salary || null,
          notes: form.notes || null,
        },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-6 shadow-sm md:grid-cols-3">
      <h3 className="text-lg font-semibold md:col-span-3">{employee ? `Edit ${employee.full_name}` : "Add a person"}</h3>
      <div className="space-y-2">
        <Label htmlFor="emp-name">Full name *</Label>
        <Input id="emp-name" required autoFocus value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-role">Role * <InfoTip text={HELP.role} /></Label>
        <NativeSelect id="emp-role" required value={form.role_id} onChange={(e) => set({ role_id: e.target.value })}>
          <option value="">Select…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {role ? roleAbilities(role) : "Roles are set up under "}
          {!role && (
            <Link href="/settings/roles" className="text-primary hover:underline">
              Settings → Roles
            </Link>
          )}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-team">Team <InfoTip text={HELP.team} /></Label>
        <NativeSelect id="emp-team" value={form.team_id} onChange={(e) => set({ team_id: e.target.value })}>
          <option value="">No team</option>
          {teamOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.lead ? ` · lead ${t.lead.name}` : ""}
            </option>
          ))}
        </NativeSelect>
        {teams.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No teams yet —{" "}
            <Link href="/people/teams" className="text-primary hover:underline">
              create one
            </Link>
            .
          </p>
        )}
      </div>
      {employee && teamChanged && (
        <div className="space-y-2">
          <Label htmlFor="emp-team-date">Team change from <InfoTip text={HELP.effectiveDate} /></Label>
          <Input
            id="emp-team-date"
            type="date"
            max={todayISO()}
            value={form.team_effective_date}
            onChange={(e) => set({ team_effective_date: e.target.value })}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="emp-email">Email</Label>
        <Input id="emp-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-phone">Phone</Label>
        <Input id="emp-phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-join">Joined on</Label>
        <Input id="emp-join" type="date" value={form.join_date} onChange={(e) => set({ join_date: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-salary">Fixed pay / month <InfoTip text={HELP.fixedPay} /></Label>
        <Input id="emp-salary" type="number" min="0" step="1" value={form.monthly_salary} onChange={(e) => set({ monthly_salary: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-cur">Currency</Label>
        <NativeSelect id="emp-cur" value={form.salary_currency} onChange={(e) => set({ salary_currency: e.target.value })}>
          <option value="INR">INR</option>
          <option value="USD">USD</option>
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-notes">Notes</Label>
        <Input id="emp-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      {employee && (
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
          Active (to deactivate, first hand over their channels and any team they lead)
        </label>
      )}
      <p className="text-xs text-muted-foreground md:col-span-3">Incentive % per person comes in Part 4, with effective dates.</p>
      {error && (
        <div className="md:col-span-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      <div className="flex gap-3 md:col-span-3">
        <Button type="submit">{employee ? "Save changes" : "Add person"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
