"use client";

import { DealForm } from "@/components/deal-form";
import { PageHeader } from "@/components/page-header";

export default function NewDealPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader title="New deal" description="Record a content licence and the slots it allows." />
      <DealForm deal={null} />
    </div>
  );
}
