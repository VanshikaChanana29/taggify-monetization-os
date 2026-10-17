"use client";

import { Activity, Building2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { useOrganization, useSession } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

type Health = { status: string; db: string };

export default function DashboardPage() {
  const { me } = useSession();
  const organization = useOrganization();
  const [health, setHealth] = useState<Health | null>(null);
  const [founders, setFounders] = useState<number | null>(null);

  useEffect(() => {
    api<Health>("/health")
      .then(setHealth)
      .catch(() => setHealth({ status: "error", db: "error" }));
    api<Member[]>("/users")
      .then((members) => setFounders(members.filter((m) => m.is_active).length))
      .catch(() => {});
  }, []);

  const ok = health?.status === "ok";

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${me.user.full_name.split(" ")[0]}`}
        description={`${organization.name} monetization overview.`}
      />

      <div className="grid gap-5 md:grid-cols-3">
        <StatCard label="Company" value={organization.name} icon={Building2} />
        <StatCard label="Active founders" value={founders ?? "—"} icon={Users} tone="green" />
        <StatCard
          label="System"
          value={health ? (ok ? "Online" : "Degraded") : "…"}
          icon={Activity}
          tone={health && !ok ? "amber" : "green"}
        />
      </div>

      <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
        <p className="text-lg font-semibold">Founder dashboard coming in Part 5</p>
        <p className="mt-1 text-muted-foreground">
          Gross, net, cash received, deal recovery, and what needs attention — all on this page.
        </p>
      </div>
    </div>
  );
}
