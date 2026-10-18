"use client";

import { Suspense } from "react";

import { FinanceShell } from "@/components/finance/finance-shell";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <FinanceShell>{children}</FinanceShell>
    </Suspense>
  );
}
