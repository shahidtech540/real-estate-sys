"use client";

import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { apiRequest, errorCodeOf } from "@/components/http";
import { useErrorMessage, useT } from "@/i18n/client";
import type { ProjectDto } from "@/modules/setup";

/**
 * Settings → Projects (`DESIGN.md` §13.14, `PRD.md` §11 #14, US-1.2).
 *
 * Covers SET-3 … SET-7 only. Blocks are the next Phase-2 PR; plots and the map
 * are Phase 3 (`IMPLEMENTATION-PLAN.md` §2.4–§2.5), so nothing here draws or
 * links to them.
 *
 * Two client-side rules from the documents:
 * - `version` is never shown. It is carried from the row into every PATCH and
 *   SET-7 body, and a `409 CONFLICT_STALE_WRITE` becomes "reload and try again"
 *   (`API.md` §1.6).
 * - `422 MASTER_PLAN_ASPECT_CHANGED` is a question, not a failure: the Admin
 *   sees the distortion warning and either re-submits with
 *   `confirmAspectRatioChange: true` or cancels (`API.md` V-12, `DESIGN.md` §8).
 */

export interface ProjectsPanelProps {
  initialProjects: ProjectDto[];
  initialTotal: number;
  /** `company.marlaSqft` — the NOT NULL singleton value (`DATABASE.md` §3.2). */
  companyMarlaSqft: string;
}

type StatusFilter = "all" | "active" | "inactive";

interface ProjectForm {
  name: string;
  location: string;
  marlaSqft: string;
  isActive: boolean;
}

const EMPTY_FORM: ProjectForm = {
  name: "",
  location: "",
  marlaSqft: "",
  isActive: true,
};

interface PageOfProjects {
  data: ProjectDto[];
  page: number;
  pageSize: number;
  total: number;
}

function formFromProject(project: ProjectDto): ProjectForm {
  return {
    name: project.name,
    location: project.location ?? "",
    marlaSqft: project.marlaSqft ?? "",
    isActive: project.isActive,
  };
}

/** `API.md` §1.8: an absent optional text is `null`, never `""`. */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const FIELD_CLASS =
  "mt-1 w-full rounded-sm border border-line bg-surface px-3 py-2 text-ink-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100";
const LABEL_CLASS = "block text-sm font-medium text-ink-700";
const HINT_CLASS = "mt-1 block text-xs text-ink-500";
const SECONDARY_BUTTON =
  "rounded-sm border border-line px-3 py-2 text-sm text-ink-700 hover:bg-surface-hover";
const PRIMARY_BUTTON =
  "rounded-sm bg-primary-600 px-4 py-2 text-sm font-medium text-surface hover:bg-primary-700 disabled:opacity-60";

/** Aspect-warning state: the plan is uploaded, the bind awaits confirmation. */
interface PendingPlan {
  projectId: string;
  fileId: string;
  version: number;
}

export function ProjectsPanel({
  initialProjects,
  initialTotal,
  companyMarlaSqft,
}: ProjectsPanelProps) {
  const t = useT();
  const errorMessage = useErrorMessage();

  const [projects, setProjects] = useState<ProjectDto[]>(initialProjects);
  const [total, setTotal] = useState(initialTotal);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectForm>({ ...EMPTY_FORM });
  const [savingCreate, setSavingCreate] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProjectForm>({ ...EMPTY_FORM });
  const [savingEdit, setSavingEdit] = useState(false);
  const [staleId, setStaleId] = useState<string | null>(null);

  const [uploadingPlan, setUploadingPlan] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);

  const loadProjects = useCallback(
    async (nextFilter: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const query =
          nextFilter === "all"
            ? ""
            : `&isActive=${nextFilter === "active" ? "true" : "false"}`;
        const page = await apiRequest<PageOfProjects>(
          `/api/projects?page=1&pageSize=50&sort=name&order=asc${query}`,
        );
        if (page) {
          setProjects(page.data);
          setTotal(page.total);
        }
      } catch (caught) {
        setError(errorMessage(errorCodeOf(caught)));
      } finally {
        setLoading(false);
      }
    },
    [errorMessage],
  );

  const changeFilter = (next: StatusFilter) => {
    setFilter(next);
    setEditingId(null);
    setPendingPlan(null);
    void loadProjects(next);
  };

  const replaceRow = (project: ProjectDto) => {
    setProjects((current) =>
      current.map((row) => (row.id === project.id ? project : row)),
    );
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingCreate(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiRequest<ProjectDto>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name,
          location: textOrNull(createForm.location),
          // Empty means "inherit the company conversion" (API.md SET-4).
          marlaSqft:
            createForm.marlaSqft.trim() === "" ? null : createForm.marlaSqft,
        }),
      });
      if (created) {
        setCreateForm({ ...EMPTY_FORM });
        setCreating(false);
        setNotice(t("projects.created"));
        await loadProjects(filter);
      }
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setSavingCreate(false);
    }
  };

  const startEdit = (project: ProjectDto) => {
    setEditingId(project.id);
    setEditForm(formFromProject(project));
    setStaleId(null);
    setPendingPlan(null);
    setError(null);
    setNotice(null);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const project = projects.find((row) => row.id === editingId);
    if (!project) return;
    setSavingEdit(true);
    setError(null);
    setNotice(null);
    try {
      // `version` travels with the body but is never a user-facing field.
      const updated = await apiRequest<ProjectDto>(
        `/api/projects/${project.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: project.version,
            name: editForm.name,
            location: textOrNull(editForm.location),
            marlaSqft:
              editForm.marlaSqft.trim() === "" ? null : editForm.marlaSqft,
            isActive: editForm.isActive,
          }),
        },
      );
      if (updated) {
        replaceRow(updated);
        setEditingId(null);
        setStaleId(null);
        setNotice(t("projects.saved"));
      }
    } catch (caught) {
      // Stale write: keep the form open, ask for a reload (API.md §1.6).
      if (errorCodeOf(caught) === "CONFLICT_STALE_WRITE") {
        setStaleId(project.id);
      } else {
        setError(errorMessage(errorCodeOf(caught)));
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const reloadRow = async (id: string) => {
    setError(null);
    try {
      const row = await apiRequest<ProjectDto>(`/api/projects/${id}`);
      if (row) {
        replaceRow(row);
        setEditForm(formFromProject(row));
        setStaleId(null);
      }
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    }
  };

  /**
   * COR-1 then SET-7: upload the image with kind `MASTER_PLAN`, then bind the
   * returned `file_object.id`. An aspect change is a confirmation step, not an
   * error the user has to decode.
   */
  const bindPlan = async (
    project: ProjectDto,
    fileId: string,
    confirmAspectRatioChange: boolean,
  ) => {
    const updated = await apiRequest<ProjectDto>(
      `/api/projects/${project.id}/master-plan`,
      {
        method: "PUT",
        body: JSON.stringify({
          fileId,
          version: project.version,
          confirmAspectRatioChange,
        }),
      },
    );
    if (updated) {
      replaceRow(updated);
      setPendingPlan(null);
      setNotice(t("projects.saved"));
    }
  };

  const uploadPlan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const project = projects.find((row) => row.id === editingId);
    if (!project) return;

    setUploadingPlan(true);
    setError(null);
    setNotice(null);
    setPendingPlan(null);
    try {
      const data = new FormData();
      data.set("kind", "MASTER_PLAN");
      data.set("file", file);
      const uploaded = await apiRequest<{ id: string }>("/api/files", {
        method: "POST",
        body: data,
      });
      if (!uploaded) return;
      try {
        await bindPlan(project, uploaded.id, false);
      } catch (caught) {
        if (errorCodeOf(caught) === "MASTER_PLAN_ASPECT_CHANGED") {
          setPendingPlan({
            projectId: project.id,
            fileId: uploaded.id,
            version: project.version,
          });
        } else if (errorCodeOf(caught) === "CONFLICT_STALE_WRITE") {
          setStaleId(project.id);
        } else {
          setError(errorMessage(errorCodeOf(caught)));
        }
      }
    } catch (caught) {
      setError(errorMessage(errorCodeOf(caught)));
    } finally {
      setUploadingPlan(false);
    }
  };

  const confirmAspectChange = async () => {
    if (!pendingPlan) return;
    const project = projects.find((row) => row.id === pendingPlan.projectId);
    if (!project) {
      setPendingPlan(null);
      setError(errorMessage("PROJECT_NOT_FOUND"));
      return;
    }
    setError(null);
    setUploadingPlan(true);
    try {
      await bindPlan(project, pendingPlan.fileId, true);
    } catch (caught) {
      if (errorCodeOf(caught) === "CONFLICT_STALE_WRITE") {
        setStaleId(pendingPlan.projectId);
        setPendingPlan(null);
      } else {
        setError(errorMessage(errorCodeOf(caught)));
      }
    } finally {
      setUploadingPlan(false);
    }
  };

  const conversionText = (project: ProjectDto): string =>
    project.marlaSqft
      ? t("projects.sqftPerMarla", { value: project.marlaSqft })
      : t("projects.inherited", { value: companyMarlaSqft });

  return (
    <section className="mt-10 border-t border-line pt-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">
            {t("projects.title")}
          </h2>
          <p className="mt-1 text-sm text-ink-500">{t("projects.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating((open) => !open);
            setCreateForm({ ...EMPTY_FORM });
          }}
          className={PRIMARY_BUTTON}
        >
          {t("projects.create")}
        </button>
      </header>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger-600 bg-danger-50 px-4 py-3 text-sm text-danger-600"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadProjects(filter)}
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

      <div className="mt-4 flex items-center gap-2">
        {(["all", "active", "inactive"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeFilter(option)}
            aria-pressed={filter === option}
            className={`rounded-sm border px-3 py-1 text-xs font-medium ${
              filter === option
                ? "border-primary-600 bg-primary-50 text-primary-700"
                : "border-line text-ink-700 hover:bg-surface-hover"
            }`}
          >
            {option === "all"
              ? t("projects.filterAll")
              : option === "active"
                ? t("projects.filterActive")
                : t("projects.filterInactive")}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-500">
          {t("projects.total", { count: total })}
        </span>
      </div>

      {creating ? (
        <form
          onSubmit={(event) => void createProject(event)}
          className="mt-4 space-y-4 rounded-md border border-line bg-surface p-4"
        >
          <h3 className="text-sm font-semibold text-ink-900">
            {t("projects.createTitle")}
          </h3>
          <div>
            <label htmlFor="project-name" className={LABEL_CLASS}>
              {t("projects.name")}
            </label>
            <input
              id="project-name"
              name="name"
              type="text"
              dir="auto"
              required
              aria-required="true"
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label htmlFor="project-location" className={LABEL_CLASS}>
              {t("projects.location")}
            </label>
            <input
              id="project-location"
              name="location"
              type="text"
              dir="auto"
              value={createForm.location}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label htmlFor="project-marla" className={LABEL_CLASS}>
              {t("projects.marla")}
            </label>
            <input
              id="project-marla"
              name="marlaSqft"
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder={companyMarlaSqft ?? undefined}
              value={createForm.marlaSqft}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  marlaSqft: event.target.value,
                }))
              }
              className={`${FIELD_CLASS} tnum`}
            />
            <span className={HINT_CLASS}>{t("projects.marlaHint")}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingCreate}
              className={PRIMARY_BUTTON}
            >
              {savingCreate ? t("common.saving") : t("projects.save")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={SECONDARY_BUTTON}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {!loading && projects.length === 0 ? (
        <p className="mt-6 rounded-md border border-line bg-surface p-6 text-sm text-ink-500">
          {t("projects.empty")}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {projects.map((project) => (
          <li
            key={project.id}
            className="rounded-md border border-line bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">
                  {project.name}
                </h3>
                {project.location ? (
                  <p className="mt-1 text-xs text-ink-500">
                    {project.location}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-ink-500">
                  {conversionText(project)}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {project.masterPlan
                    ? t("projects.planSummary", {
                        width: project.masterPlan.widthPx,
                        height: project.masterPlan.heightPx,
                      })
                    : t("projects.noMasterPlan")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-sm px-2 py-1 text-xs font-medium ${
                    project.isActive
                      ? "bg-success-50 text-success-700"
                      : "bg-surface-sunken text-ink-500"
                  }`}
                >
                  {project.isActive ? t("common.active") : t("common.inactive")}
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(project)}
                  className={SECONDARY_BUTTON}
                >
                  {t("common.edit")}
                </button>
              </div>
            </div>

            {editingId === project.id ? (
              <form
                onSubmit={(event) => void saveEdit(event)}
                className="mt-4 space-y-4 border-t border-line pt-4"
              >
                <h4 className="text-sm font-semibold text-ink-900">
                  {t("projects.editTitle")}
                </h4>

                {staleId === project.id ? (
                  <div
                    role="alert"
                    className="rounded-md border border-warning-700 bg-warning-50 px-4 py-3 text-sm text-warning-700"
                  >
                    <p className="font-medium">{t("projects.staleTitle")}</p>
                    <p className="mt-1">{t("projects.staleBody")}</p>
                    <button
                      type="button"
                      onClick={() => void reloadRow(project.id)}
                      className="mt-2 rounded-sm border border-warning-700 px-3 py-1 text-xs font-medium"
                    >
                      {t("projects.reload")}
                    </button>
                  </div>
                ) : null}

                <div>
                  <label htmlFor="edit-project-name" className={LABEL_CLASS}>
                    {t("projects.name")}
                  </label>
                  <input
                    id="edit-project-name"
                    name="name"
                    type="text"
                    dir="auto"
                    required
                    aria-required="true"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-project-location"
                    className={LABEL_CLASS}
                  >
                    {t("projects.location")}
                  </label>
                  <input
                    id="edit-project-location"
                    name="location"
                    type="text"
                    dir="auto"
                    value={editForm.location}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="edit-project-marla" className={LABEL_CLASS}>
                    {t("projects.marla")}
                  </label>
                  <input
                    id="edit-project-marla"
                    name="marlaSqft"
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={editForm.marlaSqft}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        marlaSqft: event.target.value,
                      }))
                    }
                    className={`${FIELD_CLASS} tnum`}
                  />
                  <span className={HINT_CLASS}>{t("projects.marlaHint")}</span>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    name="isActive"
                    checked={editForm.isActive}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  {t("projects.isActive")}
                </label>
                <p className="text-xs text-ink-500">
                  {t("projects.inactiveHint")}
                </p>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className={PRIMARY_BUTTON}
                  >
                    {savingEdit ? t("common.saving") : t("projects.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className={SECONDARY_BUTTON}
                  >
                    {t("common.cancel")}
                  </button>
                </div>

                <div className="rounded-md border border-line bg-surface-sunken p-4">
                  <h5 className="text-sm font-medium text-ink-700">
                    {t("projects.masterPlan")}
                  </h5>
                  {project.masterPlan ? (
                    <div className="mt-2">
                      {/* Private file served by COR-2 on this origin. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={project.masterPlan.url}
                        alt={t("projects.masterPlanAlt")}
                        className="mb-2 h-24 w-auto rounded-sm border border-line bg-surface"
                      />
                      <p className="text-xs text-ink-500">
                        {t("projects.dimensions", {
                          width: project.masterPlan.widthPx,
                          height: project.masterPlan.heightPx,
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-500">
                      {t("projects.noMasterPlan")}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <label
                      htmlFor={`project-plan-${project.id}`}
                      className={`cursor-pointer ${SECONDARY_BUTTON}`}
                    >
                      {project.masterPlan
                        ? t("projects.replacePlan")
                        : t("projects.uploadPlan")}
                    </label>
                    <input
                      id={`project-plan-${project.id}`}
                      name="masterPlan"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void uploadPlan(event)}
                      disabled={uploadingPlan}
                      className="sr-only"
                    />
                    {uploadingPlan ? (
                      <span role="status" className="text-xs text-ink-500">
                        {t("projects.uploadingPlan")}
                      </span>
                    ) : null}
                  </div>
                  <span className={HINT_CLASS}>
                    {t("projects.masterPlanHint")}
                  </span>

                  {pendingPlan && pendingPlan.projectId === project.id ? (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-warning-700 bg-warning-50 px-4 py-3 text-sm text-warning-700"
                    >
                      <p className="font-medium">{t("projects.aspectTitle")}</p>
                      <p className="mt-1">{t("projects.aspectBody")}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void confirmAspectChange()}
                          disabled={uploadingPlan}
                          className="rounded-sm bg-warning-700 px-3 py-1 text-xs font-medium text-surface disabled:opacity-60"
                        >
                          {t("projects.aspectProceed")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPlan(null)}
                          className="rounded-sm border border-warning-700 px-3 py-1 text-xs font-medium"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {loading ? (
        <div role="status" aria-busy="true" className="mt-4 space-y-3">
          <span className="sr-only">{t("common.loading")}</span>
          <div className="h-16 w-full rounded-md bg-surface-hover" />
        </div>
      ) : null}
    </section>
  );
}
