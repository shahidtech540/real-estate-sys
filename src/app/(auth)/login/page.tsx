import { redirect } from "next/navigation";
import { getPageSession } from "@/modules/identity";
import { LoginView } from "./login-view";

/**
 * Login screen (IMPLEMENTATION-PLAN.md §1.4) — DESIGN.md §13.1.
 *
 * The forced-change flow of `API.md` §2.3 lands on the same screen: a valid
 * session whose user must change their password renders the change form instead
 * of redirecting, so the gate can never trap the user on a dead page.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getPageSession();
  if (session && !session.user.mustChangePassword) redirect("/dashboard");
  return (
    <LoginView
      language={session?.user.preferredLanguage ?? "EN"}
      email={session?.user.email ?? ""}
      mustChangePassword={Boolean(session?.user.mustChangePassword)}
    />
  );
}
