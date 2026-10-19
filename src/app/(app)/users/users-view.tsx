"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest, errorCodeOf } from "@/components/http";
import { useErrorMessage, useT } from "@/i18n/client";

/**
 * Users screen — DESIGN.md §13.15 and `API.md` §3.1 IDN-3…IDN-8.
 *
 * Standard List Page: page header, table, row actions. The create/edit form is
 * the 480px dialog DESIGN.md calls for; the role control is a radio group with
 * the PRD §10 descriptions as helper text.
 */

type Role = "ADMIN" | "SALES_AGENT" | "ACCOUNTANT";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: "EN" | "UR";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageResponse {
  data: UserRow[];
  page: number;
  pageSize: number;
  total: number;
}

const ROLES: Role[] = ["ADMIN", "SALES_AGENT", "ACCOUNTANT"];

function roleLabel(t: ReturnType<typeof useT>, role: Role): string {
  if (role === "ADMIN") return t("users.roleAdmin");
  if (role === "SALES_AGENT") return t("users.roleSales");
  return t("users.roleAccountant");
}

const fieldClass =
  "mt-1 w-full rounded-sm border border-line bg-surface px-3 py-2 text-ink-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100";

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-surface p-6 shadow-lg">
          <Dialog.Title className="text-base font-semibold text-ink-900">
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface UsersViewProps {
  initialRows: UserRow[];
  initialTotal: number;
}

export function UsersView({ initialRows, initialTotal }: UsersViewProps) {
  const t = useT();
  const errorMessage = useErrorMessage();
  const router = useRouter();

  const [rows, setRows] = useState<UserRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiRequest<PageResponse>(
        "/api/users?page=1&pageSize=100&sort=name&order=asc",
      );
      setRows(page?.data ?? []);
      setTotal(page?.total ?? 0);
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setLoading(false);
    }
  }, [errorMessage]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        router.replace("/login");
        return;
      }
      setError(errorMessage(errorCodeOf(caught)));
    }
  };

  const toggleActive = (user: UserRow) =>
    act(async () => {
      await apiRequest(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      });
    });

  const unlock = (user: UserRow) =>
    act(async () => {
      await apiRequest(`/api/users/${user.id}/unlock`, { method: "POST" });
      setNotice(t("users.unlockDone"));
    });

  const resetPassword = (user: UserRow) =>
    act(async () => {
      const result = await apiRequest<{ temporaryPassword: string }>(
        `/api/users/${user.id}/password-reset`,
        { method: "POST" },
      );
      setTemporaryPassword(result?.temporaryPassword ?? null);
    });

  return (
    <div>
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            {t("users.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{t("users.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-sm bg-primary-600 px-4 py-2 text-sm font-medium text-surface hover:bg-primary-700"
        >
          {t("users.newUser")}
        </button>
      </header>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-sm border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-sm border border-success-700 bg-success-50 px-3 py-2 text-sm text-success-700">
          {notice}
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">{t("common.name")}</th>
              <th className="px-4 py-3 font-medium">{t("common.email")}</th>
              <th className="px-4 py-3 font-medium">{t("common.phone")}</th>
              <th className="px-4 py-3 font-medium">{t("common.role")}</th>
              <th className="px-4 py-3 font-medium">{t("common.status")}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t("common.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-500">
                  {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-500">
                  {t("users.empty")}
                </td>
              </tr>
            ) : (
              rows.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-line hover:bg-surface-hover"
                >
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {user.name}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{user.email}</td>
                  <td className="tnum px-4 py-3 text-ink-700">
                    {user.phone ?? ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-sm bg-surface-sunken px-2 py-1 text-xs text-ink-700">
                      {roleLabel(t, user.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-sm px-2 py-1 text-xs ${
                        user.isActive
                          ? "bg-success-50 text-success-700"
                          : "bg-surface-sunken text-ink-500"
                      }`}
                    >
                      {user.isActive
                        ? t("common.active")
                        : t("common.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(user)}
                        className="text-primary-600 hover:underline"
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void resetPassword(user)}
                        className="text-primary-600 hover:underline"
                      >
                        {t("users.resetPassword")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void unlock(user)}
                        className="text-primary-600 hover:underline"
                      >
                        {t("users.unlock")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(user)}
                        className="text-danger-600 hover:underline"
                      >
                        {user.isActive
                          ? t("users.deactivate")
                          : t("users.activate")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-500">{`${rows.length} / ${total}`}</p>

      <UserDialog
        open={creating}
        title={t("users.createTitle")}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await load();
        }}
      />

      {editing ? (
        <UserDialog
          open
          title={t("users.editTitle")}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <Modal
        open={temporaryPassword !== null}
        title={t("users.resetTitle")}
        onClose={() => setTemporaryPassword(null)}
      >
        <p className="mt-3 text-sm text-ink-500">
          {t("users.temporaryPassword")}
        </p>
        <p className="mt-2 rounded-sm border border-line bg-surface-sunken px-3 py-2 font-mono text-ink-900">
          {temporaryPassword}
        </p>
        <p className="mt-2 text-xs text-ink-500">{t("users.tempShownOnce")}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setTemporaryPassword(null)}
            className="rounded-sm border border-line px-3 py-1 text-sm text-ink-700 hover:bg-surface-hover"
          >
            {t("common.close")}
          </button>
        </div>
      </Modal>
    </div>
  );
}

interface UserDialogProps {
  open: boolean;
  title: string;
  user?: UserRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function UserDialog({ open, title, user, onClose, onSaved }: UserDialogProps) {
  const t = useT();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "SALES_AGENT");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (user) {
        await apiRequest(`/api/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, phone: phone || null, role }),
        });
      } else {
        await apiRequest("/api/users", {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            phone: phone || null,
            role,
            password,
          }),
        });
      }
      await onSaved();
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="mt-4 space-y-3"
      >
        {error ? (
          <div
            role="alert"
            className="rounded-sm border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {error}
          </div>
        ) : null}
        <label className="block text-sm font-medium text-ink-700">
          {t("common.name")}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          {t("common.email")}
          <input
            type="email"
            required
            disabled={Boolean(user)}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          {t("common.phone")}
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={fieldClass}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-ink-700">
            {t("common.role")}
          </legend>
          <div className="mt-2 space-y-1">
            {ROLES.map((option) => (
              <label
                key={option}
                className="flex items-start gap-2 text-sm text-ink-700"
              >
                <input
                  type="radio"
                  name="role"
                  checked={role === option}
                  onChange={() => setRole(option)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-ink-900">
                    {roleLabel(t, option)}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {option === "ADMIN"
                      ? t("users.roleHintAdmin")
                      : option === "SALES_AGENT"
                        ? t("users.roleHintSales")
                        : t("users.roleHintAccountant")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {user ? null : (
          <label className="block text-sm font-medium text-ink-700">
            {t("common.password")}
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClass}
            />
            <span className="mt-1 block text-xs text-ink-500">
              {t("auth.passwordRule")}
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line px-3 py-1 text-sm text-ink-700 hover:bg-surface-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-sm bg-primary-600 px-4 py-2 text-sm font-medium text-surface hover:bg-primary-700 disabled:opacity-60"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
