import { redirect } from "next/navigation";

// A CMS's slabs now sit on its page in CMS & Finance (Contract slabs tab).
export default async function CmsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { tiers } = await searchParams;
  redirect(`/finance/${id}?tab=slabs${tiers === "new" ? "&slabs=new" : ""}`);
}
