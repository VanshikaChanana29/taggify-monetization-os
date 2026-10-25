"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DealForm } from "@/components/deal-form";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import type { Deal } from "@/lib/types";

export default function EditDealPage() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Deal>(`/deals/${id}`)
      .then(setDeal)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  return (
    <div className="space-y-6">
      <PageHeader title={deal ? `Edit ${deal.title}` : "Edit deal"} description="Every change is recorded in the deal's activity." />
      {error && <Notice kind="error">{error}</Notice>}
      {deal && <DealForm deal={deal} />}
    </div>
  );
}
