const LAST_OPENED_PROJECT_ID_KEY = "beautyvoicetts:lastOpenedProjectId";
const PROJECT_SOURCES_KEY = "beautyvoicetts:projectSources";

export function safeReadLastOpenedProjectId() {
  try {
    return window.localStorage.getItem(LAST_OPENED_PROJECT_ID_KEY) || "";
  } catch {
    return "";
  }
}

export function safeWriteLastOpenedProjectId(projectId) {
  try {
    if (!projectId) {
      window.localStorage.removeItem(LAST_OPENED_PROJECT_ID_KEY);
      return;
    }
    window.localStorage.setItem(LAST_OPENED_PROJECT_ID_KEY, projectId);
  } catch {
    // Ignore localStorage failures.
  }
}

export function safeReadProjectSources() {
  try {
    const raw = window.localStorage.getItem(PROJECT_SOURCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function safeWriteProjectSources(projectSources) {
  try {
    const payload = projectSources && typeof projectSources === "object" ? projectSources : {};
    window.localStorage.setItem(PROJECT_SOURCES_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage failures.
  }
}

export function toProjectSummary(project) {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    updated_at: project.updated_at,
    origin_kind: project?.project_origin?.kind || "local",
    source_project_id: project?.project_origin?.source_project_id || null,
    project_file_name: project?.project_origin?.project_file_name || null,
  };
}

function toTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function upsertProjectSummary(projects, summary) {
  if (!summary?.id) return projects || [];
  return [summary, ...(projects || []).filter((item) => item.id !== summary.id)];
}

export function sortProjectSummaries(projects, lastOpenedProjectId) {
  const list = Array.isArray(projects) ? [...projects] : [];
  list.sort((a, b) => {
    if (a.id === lastOpenedProjectId && b.id !== lastOpenedProjectId) return -1;
    if (b.id === lastOpenedProjectId && a.id !== lastOpenedProjectId) return 1;
    return toTimestamp(b.updated_at) - toTimestamp(a.updated_at);
  });
  return list;
}

export function deriveProjectSourceFromProject(project) {
  const kind = project?.project_origin?.kind;
  return typeof kind === "string" && kind ? kind : null;
}

export function deriveProjectSourceFromSummary(summary) {
  const kind = summary?.origin_kind;
  return typeof kind === "string" && kind ? kind : null;
}

export function mergeProjectSourcesFromSummaries(existingSources, summaries) {
  const next = { ...(existingSources || {}) };
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    if (!summary?.id) continue;
    const source = deriveProjectSourceFromSummary(summary);
    if (source) {
      next[summary.id] = source;
    } else if (!next[summary.id]) {
      next[summary.id] = "local";
    }
  }
  return next;
}

export function getBindingForProject(state, projectId) {
  if (!projectId) return null;
  return state.projectFileBindings?.[projectId] || null;
}

export function getCurrentBindingState(state, currentProject) {
  const binding = getBindingForProject(state, currentProject?.id);
  const originFileName =
    currentProject?.project_origin?.kind === "project_file"
      ? currentProject?.project_origin?.project_file_name || ""
      : "";
  return {
    currentProjectFileHandle: binding?.handle || null,
    currentProjectFileName: binding?.fileName || originFileName,
  };
}
