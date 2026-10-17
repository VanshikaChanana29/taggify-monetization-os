"use client";

import { useState } from "react";

import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PasswordInput } from "@/components/password-input";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";

export default function AccountPage() {
  const { me } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    try {
      await api("/auth/change-password", {
        method: "POST",
        json: { current_password: current, new_password: next },
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice("Password changed. Other devices have been logged out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="My account" description="Your profile and password." />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <UserAvatar name={me.user.full_name} square className="h-14 w-14 text-lg" />
            <div>
              <p className="text-lg font-semibold">{me.user.full_name}</p>
              <p className="text-muted-foreground">{me.user.email}</p>
            </div>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between border-t pt-3">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-medium">{me.user.is_superadmin ? "Super admin" : "Founder"}</dd>
            </div>
            <div className="flex justify-between border-t pt-3">
              <dt className="text-muted-foreground">Companies</dt>
              <dd className="font-medium">
                {me.organizations.map((o) => o.name).join(", ") || "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Change password</h3>
          <p className="text-sm text-muted-foreground">At least 10 characters.</p>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <PasswordInput
                id="current"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <PasswordInput
                id="new"
                autoComplete="new-password"
                minLength={10}
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Repeat new password</Label>
              <PasswordInput
                id="confirm"
                autoComplete="new-password"
                minLength={10}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <Notice kind="error">{error}</Notice>}
            {notice && <Notice kind="success">{notice}</Notice>}
            <Button type="submit">Change password</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
