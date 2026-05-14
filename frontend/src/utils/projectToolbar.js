import { getLanguage } from "../i18n/core";
import { MESSAGES } from "../i18n/messages";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

export function toProjectFileDisplayName(fileName) {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  if (/\.bvtproject\.json$/i.test(raw)) {
    return raw.replace(/\.bvtproject\.json$/i, "");
  }
  return raw.replace(/\.json$/i, "");
}

export function getProjectSourceTag(source) {
  if (source === "project_file") return t("util.project.source.file");
  if (source === "archive_import") return "ZIP";
  return t("util.project.source.local");
}

export function shortProjectId(projectId) {
  return String(projectId || "").slice(0, 8);
}

export function getSameNameSiblingProjects(projects = [], currentProject = null) {
  if (!currentProject?.name) return [];
  return projects.filter((item) => item?.name === currentProject.name && item?.id !== currentProject.id);
}

export function buildProjectOption(project, source) {
  const sourceTag = getProjectSourceTag(source);
  const fileName = toProjectFileDisplayName(project?.project_file_name);
  const detailParts = [];
  if (fileName) {
    detailParts.push(fileName);
  }
  if (project?.id) {
    detailParts.push(`#${shortProjectId(project.id)}`);
  }
  return {
    value: project?.id || "",
    label: `${project?.name || t("text.untitledProject")} [${sourceTag}]`,
    meta: detailParts.join(" · "),
    title: detailParts.length
      ? `${project?.name || t("text.untitledProject")} [${sourceTag}] · ${detailParts.join(" · ")}`
      : `${project?.name || t("text.untitledProject")} [${sourceTag}]`,
  };
}
