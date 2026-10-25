import { redirect } from "next/navigation";

// CMS partners now live inside CMS & Finance.
export default function CmsPartnersPage() {
  redirect("/finance/partners");
}
