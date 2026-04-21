export function toProjectFileDisplayName(fileName) {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  if (/\.bvtproject\.json$/i.test(raw)) {
    return raw.replace(/\.bvtproject\.json$/i, "");
  }
  return raw.replace(/\.json$/i, "");
}

export function getProjectSourceTag(source) {
  if (source === "project_file") return "文件";
  if (source === "archive_import") return "ZIP";
  return "本地";
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
    label: `${project?.name || "未命名项目"} [${sourceTag}]`,
    meta: detailParts.join(" · "),
    title: detailParts.length
      ? `${project?.name || "未命名项目"} [${sourceTag}] · ${detailParts.join(" · ")}`
      : `${project?.name || "未命名项目"} [${sourceTag}]`,
  };
}
