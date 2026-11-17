"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { ParentDealForm } from "@/components/parent-deal-form";
import { api } from "@/lib/api";
import type { ParentDeal } from "@/lib/types";

export default function EditParentDealPage() {
  const { id } = useParams<{ id: string }>();
  const [parent, setParent] = useState<ParentDeal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ParentDeal>(`/parent-deals/${id}`)
      .then(setParent)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  return (
    <div className="space-y-6">
      <PageHeader title={parent ? `Edit ${parent.name}` : "Edit deal"} description="Every change is recorded in the activity log." />
      {error && <Notice kind="error">{error}</Notice>}
      {parent && <ParentDealForm parent={parent} />}
    </div>
  );
}
