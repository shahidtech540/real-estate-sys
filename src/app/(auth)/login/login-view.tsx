"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, apiRequest, errorCodeOf } from "@/components/http";
import { LanguageToggle } from "@/components/language-toggle";
import {
  I18nProvider,
  useErrorMessage,
  useT,
  type Language,
} from "@/i18n/client";

/**
 * DESIGN.md §13.1 (login) and §8 (error banner), with the forced-change step of
 * `API.md` §2.3.
 *
 * The screen never inspects HTTP status: it maps the stable `error.code` from
 * the envelope to a catalog sentence (`AGENTS.md` §5.4).
 */
export interface LoginViewProps {
  language: Language;
  email: string;
  mustChangePassword: boolean;
}

interface SessionInfoResponse {
  user: {
    id: string;
    name: string;
    email: string;
    mustChangePassword: boolean;
  };
  capabilities: string[];
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

function LoginCard(props: LoginViewProps) {
  const t = useT();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [step, setStep] = useState<"login" | "change">(
    props.mustChangePassword ? "change" : "login",
  );
  const [email, setEmail] = useState(props.email);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const goToApp = () => {
    router.replace("/dashboard");
    router.refresh();
  };

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const info = await apiRequest<SessionInfoResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (info?.user.mustChangePassword) {
        setCurrentPassword(password);
        setStep("change");
        return;
      }
      goToApp();
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      goToApp();
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        caught.code === "PASSWORD_CURRENT_INVALID"
      ) {
        setError(errorMessage("PASSWORD_CURRENT_INVALID"));
      } else {
        setError(errorMessage(errorCodeOf(caught)));
      }
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-sm border border-line bg-surface px-3 py-2 text-ink-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken p-6">
      <div className="absolute right-6 top-6">
        <LanguageToggle persist={false} />
      </div>
      <section className="w-[400px] rounded-md border border-line bg-surface p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          {t("common.appName")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">
          {step === "login" ? t("auth.signIn") : t("auth.changeTitle")}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {step === "login" ? t("auth.signInHint") : t("auth.changeHint")}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-sm border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {error}
          </div>
        ) : null}

        {step === "login" ? (
          <form
            onSubmit={(event) => {
              void onLogin(event);
            }}
            className="mt-6 space-y-4"
          >
            <label className="block text-sm font-medium text-ink-700">
              {t("common.email")}
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink-700">
              {t("common.password")}
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-primary-600 px-4 py-2 font-medium text-surface hover:bg-primary-700 disabled:opacity-60"
            >
              {busy ? t("common.saving") : t("auth.signInButton")}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              void onChangePassword(event);
            }}
            className="mt-6 space-y-4"
          >
            <label className="block text-sm font-medium text-ink-700">
              {t("auth.currentPassword")}
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink-700">
              {t("auth.newPassword")}
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                required
                minLength={12}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-ink-500">
                {t("auth.passwordRule")}
              </span>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-primary-600 px-4 py-2 font-medium text-surface hover:bg-primary-700 disabled:opacity-60"
            >
              {busy ? t("common.saving") : t("auth.changeButton")}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-ink-500">{t("auth.contactAdmin")}</p>
      </section>
    </main>
  );
}

export function LoginView(props: LoginViewProps) {
  return (
    <I18nProvider initialLanguage={props.language}>
      <LoginCard {...props} />
    </I18nProvider>
  );
}
