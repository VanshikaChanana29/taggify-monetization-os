"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DealForm } from "@/components/deal-form";
import { PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import type { ParentDeal } from "@/lib/types";

/** A new show. From a deal's page (?parent=…) it goes under that deal. */
function NewShow() {
  const parentId = useSearchParams().get("parent");
  const [parent, setParent] = useState<ParentDeal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!parentId) return;
    api<ParentDeal>(`/parent-deals/${parentId}`)
      .then(setParent)
      .catch((err: Error) => setError(err.message));
  }, [parentId]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (parentId && !parent) return <PageLoader />;

  return (
    <div className="space-y-6">
      <Link
        href={parent ? `/parent-deals/${parent.id}` : "/deals"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {parent ? parent.name : "All deals"}
      </Link>
      <PageHeader
        title={parent ? `New show in ${parent.name}` : "New show"}
        description="Record the show's rights and the slots it allows. The bar at the top turns green as you fill each section."
      />
      <DealForm deal={null} parent={parent} />
    </div>
  );
}

export default function NewDealPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewShow />
    </Suspense>
  );
}
