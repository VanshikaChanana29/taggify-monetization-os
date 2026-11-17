"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { ParentDealForm } from "@/components/parent-deal-form";

export default function NewParentDealPage() {
  return (
    <div className="space-y-6">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>
      <PageHeader
        title="New deal"
        description="One contract with a content owner: its name, total amount and dates. You add its shows next."
      />
      <ParentDealForm parent={null} />
    </div>
  );
}
