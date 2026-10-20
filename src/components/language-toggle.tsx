"use client";

import { useLanguage } from "@/i18n/client";
import { apiRequest } from "@/components/http";

/**
 * DESIGN.md §5.13 / §12.1 — two segments, `EN` / `اردو`, top-right of the page
 * and in the top bar. Switching is instant; when a user is signed in the choice
 * is persisted through IDN-2 (`ARCHITECTURE.md` §9.3). The segment labels are
 * the two endonyms and are therefore not translated.
 */
const EN_LABEL = "EN";
const UR_LABEL = "اردو";

export function LanguageToggle({ persist }: { persist: boolean }) {
  const { language, setLanguage } = useLanguage();

  const choose = (next: "EN" | "UR") => {
    setLanguage(next);
    if (persist) {
      // Fire and forget: a failed persistence must not block the UI.
      void apiRequest("/api/me/language", {
        method: "PATCH",
        body: JSON.stringify({ preferredLanguage: next }),
      }).catch(() => undefined);
    }
  };

  const base = "px-2 py-1 text-xs font-medium";
  return (
    <div
      className="inline-flex overflow-hidden rounded-sm border border-line"
      role="group"
    >
      <button
        type="button"
        aria-pressed={language === "EN"}
        onClick={() => choose("EN")}
        className={`${base} ${language === "EN" ? "bg-primary-600 text-surface" : "bg-surface text-ink-700"}`}
      >
        {EN_LABEL}
      </button>
      <button
        type="button"
        aria-pressed={language === "UR"}
        onClick={() => choose("UR")}
        className={`${base} border-l border-line ${language === "UR" ? "bg-primary-600 text-surface" : "bg-surface text-ink-700"}`}
      >
        {UR_LABEL}
      </button>
    </div>
  );
}
