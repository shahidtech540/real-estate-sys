"use client";

import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { ApiClientError, apiRequest, errorCodeOf } from "@/components/http";
import { useErrorMessage, useT } from "@/i18n/client";
import type { CompanyDto } from "@/modules/setup";

/**
 * Settings → Company profile (`DESIGN.md` §13.14, `PRD.md` §11 #14).
 *
 * Covers the company portion only — projects, blocks, expense categories and
 * reminders are later PRs of Phase 2/5/6 (`IMPLEMENTATION-PLAN.md` §2.4–§2.5).
 *
 * Every string is a catalog key (`ARCHITECTURE.md` §9.4–§9.5): no literal text
 * reaches the DOM, so the EN/UR toggle swaps the whole screen in place.
 * States follow `DESIGN.md` §8: first-run empty state, skeleton while loading,
 * inline error block with Retry, "Saving…" while the PUT is in flight.
 */

type FieldName =
  | "name"
  | "address"
  | "phone"
  | "email"
  | "pdfTermsText"
  | "marlaSqft"
  | "logoFileId";

interface FormState {
  name: string;
  address: string;
  phone: string;
  email: string;
  pdfTermsText: string;
  marlaSqft: string;
  logoFileId: string | null;
}

const EMPTY_FORM: FormState = {
  name: "",
  address: "",
  phone: "",
  email: "",
  pdfTermsText: "",
  // PRD D-1's approved default; the Admin can change it before saving.
  marlaSqft: "225.00",
  logoFileId: null,
};

function formFromCompany(company: CompanyDto | null): FormState {
  if (!company) return { ...EMPTY_FORM };
  return {
    name: company.name,
    address: company.address ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    pdfTermsText: company.pdfTermsText ?? "",
    marlaSqft: company.marlaSqft,
    logoFileId: company.logo?.id ?? null,
  };
}

/** `API.md` §1.8: omitted optional text is `null`, never `""`. */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const FIELD_CLASS =
  "mt-1 w-full rounded-sm border bg-surface px-3 py-2 text-ink-900 outline-none focus:ring-2 focus:ring-primary-100";
const LABEL_CLASS = "block text-sm font-medium text-ink-700";
const HINT_CLASS = "mt-1 block text-xs text-ink-500";

export interface SettingsViewProps {
  /** `null` = first run (`GET /api/company` → `404 COMPANY_NOT_CONFIGURED`). */
  initialCompany: CompanyDto | null;
}

export function SettingsView({ initialCompany }: SettingsViewProps) {
  const t = useT();
  const errorMessage = useErrorMessage();

  const [company, setCompany] = useState<CompanyDto | null>(initialCompany);
  const [form, setForm] = useState<FormState>(() =>
    formFromCompany(initialCompany),
  );
  const [editing, setEditing] = useState(initialCompany !== null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<FieldName[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await apiRequest<CompanyDto>("/api/company");
      setCompany(loaded);
      setForm(formFromCompany(loaded));
      setEditing(loaded !== null);
    } catch (caught) {
      // A first run is a documented empty state, not a failure (API.md SET-1).
      if (errorCodeOf(caught) === "COMPANY_NOT_CONFIGURED") {
        setCompany(null);
        setForm({ ...EMPTY_FORM });
        setEditing(false);
      } else {
        setError(errorMessage(errorCodeOf(caught)));
      }
    } finally {
      setLoading(false);
    }
  }, [errorMessage]);

  const update = (field: Exclude<FieldName, "logoFileId">, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setInvalidFields((current) => current.filter((name) => name !== field));
  };

  const removeLogo = () => {
    setForm((current) => ({ ...current, logoFileId: null }));
    setInvalidFields((current) =>
      current.filter((name) => name !== "logoFileId"),
    );
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setInvalidFields([]);
    try {
      const saved = await apiRequest<CompanyDto>("/api/company", {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          address: textOrNull(form.address),
          phone: textOrNull(form.phone),
          email: textOrNull(form.email),
          pdfTermsText: textOrNull(form.pdfTermsText),
          marlaSqft: form.marlaSqft,
          logoFileId: form.logoFileId,
        }),
      });
      if (saved) {
        setCompany(saved);
        setForm(formFromCompany(saved));
        setEditing(true);
        setNotice(t("settings.saved"));
      }
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setInvalidFields(Object.keys(caught.fields ?? {}) as FieldName[]);
      }
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setSaving(false);
    }
  };

  /**
   * COR-1 two-step flow (`API.md` §3.12): upload first, then bind the returned
   * `file_object.id` on save. The object stays an orphan until this screen binds
   * it, which is exactly how SET-2 is specified.
   */
  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const data = new FormData();
      data.set("kind", "COMPANY_LOGO");
      data.set("file", file);
      const uploaded = await apiRequest<{ id: string }>("/api/files", {
        method: "POST",
        body: data,
      });
      if (uploaded) {
        setForm((current) => ({ ...current, logoFileId: uploaded.id }));
        setInvalidFields((current) =>
          current.filter((name) => name !== "logoFileId"),
        );
      }
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setUploading(false);
    }
  };

  const fieldClass = (field: FieldName) =>
    `${FIELD_CLASS} ${
      invalidFields.includes(field)
        ? "border-danger-600"
        : "border-line focus:border-primary-600"
    }`;

  const logoUrl = form.logoFileId ? `/api/files/${form.logoFileId}` : null;

  return (
    <div>
      <header>
        <h1 className="text-lg font-semibold text-ink-900">
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{t("settings.subtitle")}</p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger-600 bg-danger-50 px-4 py-3 text-sm text-danger-600"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-2 rounded-sm border border-danger-600 px-3 py-1 text-xs font-medium"
          >
            {t("settings.retry")}
          </button>
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-success-700 bg-success-50 px-4 py-3 text-sm text-success-700"
        >
          {notice}
        </p>
      ) : null}

      {loading ? (
        <div role="status" aria-busy="true" className="mt-6 space-y-3">
          <span className="sr-only">{t("common.loading")}</span>
          <div className="h-5 w-48 rounded-sm bg-surface-hover" />
          <div className="h-10 w-full rounded-sm bg-surface-hover" />
          <div className="h-24 w-full rounded-sm bg-surface-hover" />
          <div className="h-10 w-40 rounded-sm bg-surface-hover" />
        </div>
      ) : null}

      {!loading && company === null && !editing ? (
        <div className="mt-6 rounded-md border border-line bg-surface p-8">
          <h2 className="text-base font-semibold text-ink-900">
            {t("settings.firstRunTitle")}
          </h2>
          <p className="mt-2 text-sm text-ink-500">
            {t("settings.firstRunBody")}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-4 rounded-sm bg-primary-600 px-4 py-2 text-sm font-medium text-surface hover:bg-primary-700"
          >
            {t("settings.firstRunAction")}
          </button>
        </div>
      ) : null}

      {!loading && editing ? (
        <form onSubmit={(event) => void save(event)} className="mt-6 space-y-5">
          <div>
            <label htmlFor="company-name" className={LABEL_CLASS}>
              {t("settings.name")}
              <span aria-hidden="true">{" *"}</span>
            </label>
            <input
              id="company-name"
              name="name"
              type="text"
              dir="auto"
              required
              aria-required="true"
              aria-invalid={invalidFields.includes("name")}
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              className={fieldClass("name")}
            />
          </div>

          <div>
            <label htmlFor="company-address" className={LABEL_CLASS}>
              {t("settings.address")}
            </label>
            <textarea
              id="company-address"
              name="address"
              rows={3}
              dir="auto"
              aria-invalid={invalidFields.includes("address")}
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
              className={fieldClass("address")}
            />
          </div>

          <div className="flex gap-4">
            <div className="w-1/2">
              <label htmlFor="company-phone" className={LABEL_CLASS}>
                {t("settings.phone")}
              </label>
              <input
                id="company-phone"
                name="phone"
                type="tel"
                dir="ltr"
                aria-invalid={invalidFields.includes("phone")}
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                className={fieldClass("phone")}
              />
            </div>
            <div className="w-1/2">
              <label htmlFor="company-email" className={LABEL_CLASS}>
                {t("settings.email")}
              </label>
              <input
                id="company-email"
                name="email"
                type="email"
                dir="ltr"
                aria-invalid={invalidFields.includes("email")}
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                className={fieldClass("email")}
              />
            </div>
          </div>

          <div>
            <label htmlFor="company-marla" className={LABEL_CLASS}>
              {t("settings.marlaSqft")}
              <span aria-hidden="true">{" *"}</span>
            </label>
            <input
              id="company-marla"
              name="marlaSqft"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required
              aria-required="true"
              aria-invalid={invalidFields.includes("marlaSqft")}
              value={form.marlaSqft}
              onChange={(event) => update("marlaSqft", event.target.value)}
              className={`${fieldClass("marlaSqft")} tnum`}
            />
            <span className={HINT_CLASS}>{t("settings.marlaHint")}</span>
          </div>

          <div>
            <label htmlFor="company-terms" className={LABEL_CLASS}>
              {t("settings.pdfTermsText")}
            </label>
            <textarea
              id="company-terms"
              name="pdfTermsText"
              rows={5}
              dir="auto"
              aria-invalid={invalidFields.includes("pdfTermsText")}
              value={form.pdfTermsText}
              onChange={(event) => update("pdfTermsText", event.target.value)}
              className={fieldClass("pdfTermsText")}
            />
            <span className={HINT_CLASS}>{t("settings.pdfTermsHint")}</span>
          </div>

          <fieldset className="rounded-md border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-medium text-ink-700">
              {t("settings.logo")}
            </legend>
            {logoUrl ? (
              /* Private file: served by COR-2 with the session cookie, so a
                 plain <img> on this origin is the correct control. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={t("settings.logoAlt")}
                className="mb-3 h-16 w-auto rounded-sm border border-line bg-surface"
              />
            ) : (
              <p className="mb-3 text-sm text-ink-500">
                {t("settings.noLogo")}
              </p>
            )}
            <div className="flex items-center gap-3">
              <label
                htmlFor="company-logo"
                className="cursor-pointer rounded-sm border border-line px-3 py-2 text-sm font-medium text-ink-700 hover:bg-surface-hover"
              >
                {logoUrl ? t("settings.replaceLogo") : t("settings.chooseLogo")}
              </label>
              <input
                id="company-logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void uploadLogo(event)}
                disabled={uploading}
                className="sr-only"
              />
              {logoUrl ? (
                <button
                  type="button"
                  onClick={removeLogo}
                  className="rounded-sm border border-line px-3 py-2 text-sm text-ink-700 hover:bg-surface-hover"
                >
                  {t("settings.removeLogo")}
                </button>
              ) : null}
              {uploading ? (
                <span role="status" className="text-xs text-ink-500">
                  {t("settings.uploading")}
                </span>
              ) : null}
            </div>
            <span className={HINT_CLASS}>{t("settings.logoHint")}</span>
          </fieldset>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || uploading}
              className="rounded-sm bg-primary-600 px-4 py-2 text-sm font-medium text-surface hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? t("common.saving") : t("settings.save")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
