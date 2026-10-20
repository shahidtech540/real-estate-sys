import { redirect } from "next/navigation";
import { NotAvailable } from "@/components/not-available";
import { hasCapability } from "@/core/authz/policy";
import { getPageSession, listUsers } from "@/modules/identity";
import { UsersView } from "./users-view";

/**
 * Users screen (IMPLEMENTATION-PLAN.md §1.4) — Admin only (`user.manage`,
 * `ARCHITECTURE.md` §6.2). A deep link by another role renders the DESIGN.md §6
 * empty state, not a redirect loop and not a leaked page.
 */
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getPageSession();
  if (!session) redirect("/login");
  if (!hasCapability(session.user.role, "user.manage")) {
    return <NotAvailable />;
  }
  // First page is rendered on the server so the table has no loading flash;
  // mutations refresh it through the same API the client already uses.
  const page = await listUsers(
    {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    { page: 1, pageSize: 100, sort: "name", order: "asc" },
  );
  return <UsersView initialRows={page.data} initialTotal={page.total} />;
}
