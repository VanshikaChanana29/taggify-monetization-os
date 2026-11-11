"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { DealForm } from "@/components/deal-form";
import { PageHeader } from "@/components/page-header";

export default function NewDealPage() {
  return (
    <div className="space-y-6">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>
      <PageHeader title="New deal" description="Record a content licence and the slots it allows. The bar at the top turns green as you fill each section." />
      <DealForm deal={null} />
    </div>
  );
}
