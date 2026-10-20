import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { SettingsView } from "@/app/(app)/settings/settings-view";
import en from "@/i18n/locales/en.json";
import ur from "@/i18n/locales/ur.json";
import type { CompanyDto } from "@/modules/setup";

/**
 * Settings render test — `AGENTS.md` §7.2 #10 ("every route renders in `ur` …
 * the language toggle test asserts changed text") and `ARCHITECTURE.md` §9.4.
 *
 * The server renderer is enough here: it proves every user-visible string comes
 * from the catalog (no hard-coded English leaking into Urdu mode) without a DOM
 * or a second dev dependency. Interaction is exercised by the client code paths
 * and, later, the Playwright journey.
 */

const COMPANY: CompanyDto = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Green City Developers",
  address: "12 Mall Road, Lahore",
  phone: "+924200000000",
  email: "info@example.test",
  pdfTermsText: null,
  marlaSqft: "225.00",
  logo: {
    id: "44444444-4444-4444-8444-444444444444",
    url: "/api/files/44444444-4444-4444-8444-444444444444",
  },
  updatedAt: "2026-10-19T09:15:00.000Z",
};

async function render(
  language: "en" | "ur",
  initialCompany: CompanyDto | null,
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
      <SettingsView initialCompany={initialCompany} />
    </I18nextProvider>,
  );
}

describe("Settings screen rendering (EN/UR)", () => {
  it("renders the first-run empty state in English", async () => {
    const html = await render("en", null);
    expect(html).toContain(en.settings.title);
    expect(html).toContain(en.settings.firstRunTitle);
    expect(html).toContain(en.settings.firstRunBody);
    expect(html).toContain(en.settings.firstRunAction);
    // The form is not shown before the singleton exists.
    expect(html).not.toContain(en.settings.save);
  });

  it("renders the first-run empty state in Urdu", async () => {
    const html = await render("ur", null);
    expect(html).toContain(ur.settings.title);
    expect(html).toContain(ur.settings.firstRunTitle);
    expect(html).toContain(ur.settings.firstRunAction);
    expect(html).not.toContain(en.settings.firstRunTitle);
  });

  it("renders the editable company form with values and logo in English", async () => {
    const html = await render("en", COMPANY);
    expect(html).toContain(en.settings.name);
    expect(html).toContain(en.settings.marlaSqft);
    expect(html).toContain(en.settings.pdfTermsText);
    expect(html).toContain(en.settings.replaceLogo);
    expect(html).toContain(en.settings.removeLogo);
    expect(html).toContain(`value="${COMPANY.name}"`);
    expect(html).toContain(`value="${COMPANY.marlaSqft}"`);
    expect(html).toContain(`src="${COMPANY.logo?.url ?? ""}"`);
  });

  it("renders every form label from the Urdu catalog", async () => {
    const html = await render("ur", COMPANY);
    for (const key of [
      "name",
      "address",
      "phone",
      "email",
      "pdfTermsText",
      "marlaSqft",
      "logo",
      "save",
      "replaceLogo",
      "removeLogo",
      "logoHint",
      "marlaHint",
    ] as const) {
      expect(html).toContain(ur.settings[key]);
    }
    // No English chrome leaks into Urdu mode (ARCHITECTURE.md §9.4).
    for (const key of [
      "name",
      "address",
      "email",
      "pdfTermsText",
      "marlaSqft",
      "save",
    ] as const) {
      expect(html).not.toContain(en.settings[key]);
    }
  });
});
