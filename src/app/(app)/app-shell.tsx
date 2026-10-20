"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { apiRequest } from "@/components/http";
import { I18nProvider, useT, type Language } from "@/i18n/client";

/**
 * The application shell — DESIGN.md §4.6: 56px top bar, 240px navy sidebar,
 * 24px content padding. Navigation items a role cannot use are not rendered
 * (DESIGN.md §6); the list is derived from capabilities, never from the role
 * name (`ARCHITECTURE.md` §6.2).
 *
 * Phase 1 ships the two destinations that exist (Dashboard, Users). The rest of
 * DESIGN.md §6 belongs to the later phases that build those screens; rendering
 * links to routes that do not exist yet would be a broken navigation bar.
 */
export interface ShellUser {
  name: string;
  email: string;
  role: "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";
}

export interface AppShellProps {
  user: ShellUser;
  capabilities: string[];
  language: Language;
  children: ReactNode;
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center border-l-[3px] px-4 py-2 text-sm ${
        active
          ? "border-surface bg-primary-50/10 font-semibold text-surface"
          : "border-transparent text-primary-100 hover:bg-primary-700"
      }`}
    >
      {label}
    </Link>
  );
}

function Shell({ user, capabilities, children }: AppShellProps) {
  const t = useT();
  const router = useRouter();
  const canManageUsers = capabilities.includes("user.manage");
  // Settings is Admin-only (PRD §11 #14); the nav follows `setup.manage` rather
  // than the role name (`ARCHITECTURE.md` §6.2–§6.3).
  const canManageSetup = capabilities.includes("setup.manage");

  const signOut = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-6">
        <span className="text-sm font-semibold text-ink-900">
          {t("common.appName")}
        </span>
        <div className="flex items-center gap-4">
          <LanguageToggle persist />
          <div className="text-right">
            <div className="text-sm font-medium text-ink-900">{user.name}</div>
            <div className="text-xs text-ink-500">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-sm border border-line px-3 py-1 text-sm text-ink-700 hover:bg-surface-hover"
          >
            {t("common.signOut")}
          </button>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-56px)]">
        <nav className="w-60 bg-primary-900 py-4">
          <p className="px-4 pb-2 text-xs uppercase tracking-wide text-primary-100/60">
            {t("nav.administration")}
          </p>
          <NavLink href="/dashboard" label={t("nav.dashboard")} />
          {canManageSetup ? (
            <NavLink href="/settings" label={t("nav.settings")} />
          ) : null}
          {canManageUsers ? (
            <NavLink href="/users" label={t("nav.users")} />
          ) : null}
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <I18nProvider initialLanguage={props.language}>
      <Shell {...props} />
    </I18nProvider>
  );
}
