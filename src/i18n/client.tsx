"use client";

import i18next, { type TFunction } from "i18next";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import en from "./locales/en.json";
import ur from "./locales/ur.json";

/**
 * Client i18n — `ARCHITECTURE.md` §9.4 ("translatable text renders in client
 * components") and §9.3 (the toggle persists per user). The server components
 * pass data, never strings; every label below comes from `useT()`.
 *
 * Both catalogs are imported statically so a missing key is a build-time
 * failure in `npm run i18n:check` and a visible key in development, never a
 * blank label (`ARCHITECTURE.md` §9.5).
 */
export type Language = "EN" | "UR";

export type Translate = TFunction<"translation", undefined>;

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ur: { translation: ur },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
}>({ language: "EN", setLanguage: () => undefined });

export interface I18nProviderProps {
  /** `app_user.preferred_language`, resolved on the server (default `EN`). */
  initialLanguage?: Language;
  children: ReactNode;
}

export function I18nProvider({
  initialLanguage = "EN",
  children,
}: I18nProviderProps) {
  useEffect(() => {
    // DESIGN.md §12.2: the interface stays LTR; only the text direction is auto.
    document.documentElement.lang = initialLanguage === "UR" ? "ur" : "en";
  }, [initialLanguage]);

  useEffect(() => {
    if (i18next.resolvedLanguage !== initialLanguage.toLowerCase()) {
      void i18next.changeLanguage(initialLanguage.toLowerCase());
    }
  }, [initialLanguage]);

  const value = useMemo(
    () => ({
      language: initialLanguage,
      setLanguage: (language: Language) => {
        void i18next.changeLanguage(language.toLowerCase());
      },
    }),
    [initialLanguage],
  );

  return (
    <I18nextProvider i18n={i18next}>
      <LanguageContext.Provider value={value}>
        {children}
      </LanguageContext.Provider>
    </I18nextProvider>
  );
}

export function useT(): Translate {
  const { t } = useTranslation();
  return t;
}

/** `errors.<CODE>` with a generic fallback — the only place codes become text. */
export function useErrorMessage(): (code: string | undefined) => string {
  const t = useT();
  return (code: string | undefined) => {
    if (!code) return t("common.genericError");
    const key = `errors.${code}`;
    const message = t(key);
    return message === key ? t("common.genericError") : message;
  };
}

export function useLanguage(): {
  language: Language;
  setLanguage: (language: Language) => void;
} {
  return useContext(LanguageContext);
}
