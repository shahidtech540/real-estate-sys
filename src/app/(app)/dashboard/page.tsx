"use client";

import { useT } from "@/i18n/client";

/**
 * Dashboard shell (IMPLEMENTATION-PLAN.md §1.4: "layout + nav, no widgets").
 * The KPI tiles and tables of DESIGN.md §13.2 arrive with Inventory and Sales.
 */
export default function DashboardPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-ink-900">
        {t("dashboard.title")}
      </h1>
      <p className="mt-2 text-sm text-ink-500">{t("dashboard.shellNote")}</p>
    </div>
  );
}
