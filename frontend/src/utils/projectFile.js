const DEFAULT_SYNTHESIS_CONFIG = {
  num_step: 32,
  guidance_scale: 2,
  denoise: true,
  gap_duration_ms: 300,
  output_format: "wav",
  timeline_lock_enabled: false,
};

function isFileSystemAccessAvailable() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

function sanitizeFilename(name) {
  const base = String(name || "project").trim() || "project";
  const safe = base.replace(/[\\/:|*?"<>]/g, "_").replace(/\s+/g, "_");
  return safe || "project";
}

function normalizeScript(script, fallbackName, sourceTextOverride) {
  const sourceText = sourceTextOverride ?? script?.source_text ?? "";
  return {
    title: script?.title || fallbackName || "Untitled",
    source_text: sourceText,
    segments: Array.isArray(script?.segments) ? script.segments : [],
    characters: Array.isArray(script?.characters) ? script.characters : [],
    metadata: script?.metadata && typeof script.metadata === "object" ? script.metadata : {},
  };
}

export function buildProjectFilePayload({ project, script, sourceText }) {
  const fallbackName = project?.name || "Untitled Project";
  const normalizedScript = normalizeScript(script, fallbackName, sourceText);
  const status = project?.status || (normalizedScript.segments.length ? "parsed" : "draft");

  return {
    file_type: "beautyvoice_project",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    source_project_id: project?.id || null,
    project: {
      name: fallbackName,
      status,
    },
    script: normalizedScript,
    voice_assignments: project?.voice_assignments || {},
    synthesis_config: project?.synthesis_config || DEFAULT_SYNTHESIS_CONFIG,
    metadata: {
      format: "lightweight",
      includes_audio_assets: false,
      client_export: true,
    },
  };
}

export function downloadProjectFile(payload, preferredName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(preferredName || payload?.project?.name)}.bvtproject.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function openProjectFileWithPicker() {
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") {
    return null;
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: "VoiceLace Project",
        accept: {
          "application/json": [".bvtproject.json", ".json"],
        },
      },
    ],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  return { handle, file };
}

async function writePayloadToHandle(handle, payload) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

export async function saveProjectFile({
  payload,
  preferredName,
  existingHandle = null,
  forceSaveAs = false,
}) {
  if (!isFileSystemAccessAvailable()) {
    downloadProjectFile(payload, preferredName);
    return { mode: "download", handle: existingHandle, fileName: `${sanitizeFilename(preferredName)}.bvtproject.json` };
  }

  let handle = forceSaveAs ? null : existingHandle;
  if (!handle) {
    handle = await window.showSaveFilePicker({
      suggestedName: `${sanitizeFilename(preferredName)}.bvtproject.json`,
      types: [
        {
          description: "VoiceLace Project",
          accept: {
            "application/json": [".bvtproject.json"],
          },
        },
      ],
    });
  }

  if (!handle) {
    downloadProjectFile(payload, preferredName);
    return { mode: "download", handle: existingHandle, fileName: `${sanitizeFilename(preferredName)}.bvtproject.json` };
  }

  await writePayloadToHandle(handle, payload);
  return {
    mode: "inplace",
    handle,
    fileName: handle.name || `${sanitizeFilename(preferredName)}.bvtproject.json`,
  };
}
