"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL, apiFetch } from "@/lib/api";

type Health = { status: string; db: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Health>("/health")
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  const ok = health?.status === "ok";

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>{API_URL}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!health && !error && <p className="text-muted-foreground">Checking API…</p>}
        {error && <p className="font-medium text-red-600">API unreachable — {error}</p>}
        {health && (
          <>
            <p className={ok ? "font-medium text-emerald-700" : "font-medium text-amber-600"}>
              {ok ? "API OK" : "API degraded"}
            </p>
            <p className="text-muted-foreground">Database: {health.db}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
