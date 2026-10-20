import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { capabilitiesFor } from "@/core/authz/policy";
import { getPageSession } from "@/modules/identity";
import { AppShell } from "./app-shell";

/**
 * The authenticated area. Every page under `(app)` re-resolves the session on
 * the server; middleware is not the security boundary (`ARCHITECTURE.md` §6.1).
 * A user who must change their password is sent to the login screen, which
 * renders the change form (`API.md` §2.3).
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getPageSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword) redirect("/login");

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      }}
      capabilities={capabilitiesFor(session.user.role)}
      language={session.user.preferredLanguage}
    >
      {children}
    </AppShell>
  );
}
