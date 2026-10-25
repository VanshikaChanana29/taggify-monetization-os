"use client";

import { Suspense } from "react";

import { FinanceShell } from "@/components/finance/finance-shell";
import { PageLoader } from "@/components/loader";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <FinanceShell>{children}</FinanceShell>
    </Suspense>
  );
}
