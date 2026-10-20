"use client";

import { useT } from "@/i18n/client";

/** DESIGN.md §6 — "Not available for your role", never a redirect loop. */
export function NotAvailable() {
  const t = useT();
  return (
    <div className="mx-auto max-w-xl rounded-md border border-line bg-surface p-8">
      <h1 className="text-lg font-semibold text-ink-900">
        {t("common.notAvailableTitle")}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        {t("common.notAvailableBody")}
      </p>
    </div>
  );
}
