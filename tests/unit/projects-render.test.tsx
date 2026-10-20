import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { ProjectsPanel } from "@/app/(app)/settings/projects-panel";
import en from "@/i18n/locales/en.json";
import ur from "@/i18n/locales/ur.json";
import type { ProjectDto } from "@/modules/setup";

/**
 * Projects portion of Settings — `AGENTS.md` §7.2 #10 and §9 ("Settings strings
 * in both catalogs; UR render test"), `ARCHITECTURE.md` §9.4.
 *
 * `renderToStaticMarkup` is enough: it proves every visible string comes from
 * the catalog (no English leaking into Urdu), and that `version` never reaches
 * the DOM — the UI treats it as an internal token (`API.md` §1.6).
 */

const PROJECT: ProjectDto = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Green City Phase 1",
  location: "Bahria Town, Lahore",
  marlaSqft: "225.00",
  isActive: true,
  version: 7,
  masterPlan: {
    fileId: "44444444-4444-4444-8444-444444444444",
    url: "/api/files/44444444-4444-4444-8444-444444444444",
    widthPx: 4000,
    heightPx: 3000,
    uploadedAt: "2026-10-20T10:00:00.000Z",
  },
  createdAt: "2026-10-19T09:15:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};

async function render(
  language: "en" | "ur",
  projects: ProjectDto[],
  companyMarlaSqft = "225.00",
): Promise<string> {
  const i18n = createInstance();
  await i18n.init({
    resources: {
      en: { translation: en },
      ur: { translation: ur },
    },
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ProjectsPanel
        initialProjects={projects}
        initialTotal={projects.length}
        companyMarlaSqft={companyMarlaSqft}
      />
    </I18nextProvider>,
  );
}

describe("Settings → projects rendering (EN/UR)", () => {
  it("renders the list, the conversion and the master plan in English", async () => {
    const html = await render("en", [PROJECT]);
    expect(html).toContain(en.projects.title);
    expect(html).toContain(en.projects.create);
    expect(html).toContain(PROJECT.name);
    expect(html).toContain(PROJECT.location ?? "");
    expect(html).toContain(
      en.projects.sqftPerMarla.replace("{{value}}", "225.00"),
    );
    expect(html).toContain(
      en.projects.dimensions
        .replace("{{width}}", "4000")
        .replace("{{height}}", "3000"),
    );
    expect(html).toContain(en.common.active);
    // `version` is an internal CAS token, never user-visible text.
    expect(html).not.toContain(">7<");
    expect(html).not.toMatch(/\bversion\b/i);
  });

  it("renders the empty state in English and in Urdu", async () => {
    expect(await render("en", [])).toContain(en.projects.empty);
    const urdu = await render("ur", []);
    expect(urdu).toContain(ur.projects.empty);
    expect(urdu).not.toContain(en.projects.empty);
  });

  it("renders every list label from the Urdu catalog", async () => {
    const html = await render("ur", [PROJECT]);
    for (const key of [
      "title",
      "create",
      "filterAll",
      "filterActive",
      "filterInactive",
    ] as const) {
      expect(html).toContain(ur.projects[key]);
    }
    expect(html).toContain(
      ur.projects.sqftPerMarla.replace("{{value}}", "225.00"),
    );
    expect(html).toContain(
      ur.projects.planSummary
        .replace("{{width}}", "4000")
        .replace("{{height}}", "3000"),
    );
    // No English chrome leaks into Urdu mode (ARCHITECTURE.md §9.4).
    for (const key of ["title", "create"] as const) {
      expect(html).not.toContain(en.projects[key]);
    }
  });

  it("marks an inactive project with the inactive label", async () => {
    const html = await render("en", [{ ...PROJECT, isActive: false }]);
    expect(html).toContain(en.common.inactive);
  });

  it("falls back to the company conversion when a row carries none", async () => {
    const html = await render(
      "en",
      [{ ...PROJECT, marlaSqft: null, masterPlan: null }],
      "230.50",
    );
    expect(html).toContain(
      en.projects.inherited.replace("{{value}}", "230.50"),
    );
    expect(html).toContain(en.projects.noMasterPlan);
  });
});
