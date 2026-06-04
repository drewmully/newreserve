import { redirect } from "next/navigation";

export const dynamic = "force-static";

export default function AdperformanceRedirect() {
  redirect("/admin/ad-performance");
}
