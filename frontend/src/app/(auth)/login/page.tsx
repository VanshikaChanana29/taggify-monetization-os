"use client";

import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { DevLogins } from "@/components/dev-logins";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

function nextPath(me: Me): string {
  const next = new URLSearchParams(window.location.search).get("next");
  // Only allow in-app paths, never another site.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  // A super admin with no company has nothing on the dashboard yet.
  return me.organization ? "/" : "/admin/companies";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Already logged in → skip the form.
    api<Me>("/auth/me")
      .then((me) => window.location.replace(nextPath(me)))
      .catch(() => {});
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const me = await api<Me>("/auth/login", { method: "POST", json: { email, password } });
      window.location.replace(nextPath(me));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <Brand subtitle="Monetization OS" />
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-1 text-muted-foreground">Rights, channels, revenue and payouts.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <DevLogins
          onUse={(devEmail, devPassword) => {
            setEmail(devEmail);
            setPassword(devPassword);
            setError(null);
          }}
        />
      </div>
    </div>
  );
}
