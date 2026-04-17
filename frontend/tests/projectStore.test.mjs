import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/useProjectStore.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name?.toLowerCase() === "content-type" ? "application/json" : "";
      },
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function resetProjectStore() {
  useProjectStore.setState({
    currentProject: null,
    projects: [],
    projectEvents: [],
    importWarnings: [],
    lastOpenedProjectId: "",
    projectSources: {},
    projectFileBindings: {},
    currentProjectFileHandle: null,
    currentProjectFileName: "",
    isLoading: false,
  });
}

function withFetchQueue(queue, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const expected = queue.shift();
    assert.ok(expected, `unexpected fetch call: ${url}`);
    if (typeof expected.match === "string") {
      assert.ok(String(url).includes(expected.match), `expected url to include ${expected.match}, got ${url}`);
    } else if (expected.match instanceof RegExp) {
      assert.match(String(url), expected.match);
    }
    return expected.response;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = originalFetch;
      resetProjectStore();
    });
}

function withWindowMock(fn) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.window = originalWindow;
    });
}

test("loadProjects hydrates projectSources from backend origin_kind", async () => {
  await withFetchQueue(
    [
      {
        match: "/projects",
        response: jsonResponse([
          {
            id: "p-archive",
            name: "Imported Project",
            status: "done",
            updated_at: "2026-04-18T00:00:00+00:00",
            origin_kind: "archive_import",
          },
        ]),
      },
    ],
    async () => {
      const projects = await useProjectStore.getState().loadProjects();
      assert.equal(projects.length, 1);
      const state = useProjectStore.getState();
      assert.equal(state.projectSources["p-archive"], "archive_import");
    },
  );
});

test("selectProject prefers backend project_origin and exposes origin file name", async () => {
  resetProjectStore();
  useProjectStore.setState({
    projectSources: { "p-opened": "local" },
  });

  await withFetchQueue(
    [
      {
        match: "/projects/p-opened",
        response: jsonResponse({
          id: "p-opened",
          name: "Opened From File",
          status: "parsed",
          updated_at: "2026-04-18T01:00:00+00:00",
          script: { title: "", source_text: "", segments: [], characters: [], metadata: {} },
          voice_assignments: {},
          synthesis_config: {},
          audio_assets: {
            latest_task_id: null,
            full_wav_relpath: null,
            full_mp3_relpath: null,
            subtitle_srt_relpath: null,
            subtitle_lrc_relpath: null,
            segments: {},
            full_peaks_relpath: null,
            full_peaks_version: 1,
            full_peaks_levels: [],
            archive_schema_version: 3,
          },
          project_origin: {
            kind: "project_file",
            source_project_id: "src-001",
            project_file_name: "book.bvtproject.json",
            project_file_fingerprint: "abc",
          },
        }),
      },
    ],
    async () => {
      const project = await useProjectStore.getState().selectProject("p-opened", { suppressToast: true });
      assert.equal(project.id, "p-opened");
      const state = useProjectStore.getState();
      assert.equal(state.projectSources["p-opened"], "project_file");
      assert.equal(state.currentProjectFileName, "book.bvtproject.json");
    },
  );
});

test("importProjectFile updates current project and keeps unique summary by id", async () => {
  resetProjectStore();
  useProjectStore.setState({
    projects: [
      {
        id: "p-opened",
        name: "Opened From File",
        status: "draft",
        updated_at: "2026-04-18T00:00:00+00:00",
        origin_kind: "local",
      },
      {
        id: "p-other",
        name: "Other",
        status: "done",
        updated_at: "2026-04-17T00:00:00+00:00",
        origin_kind: "local",
      },
    ],
  });

  await withWindowMock(async () => {
    await withFetchQueue(
      [
        {
          match: "/projects/import/project-file",
          response: jsonResponse({
            project_id: "p-opened",
            project_name: "Opened From File",
            import_source: "project_file",
            open_mode: "reused",
            warnings: [],
          }),
        },
        {
          match: "/projects/p-opened",
          response: jsonResponse({
            id: "p-opened",
            name: "Opened From File",
            status: "parsed",
            updated_at: "2026-04-18T02:00:00+00:00",
            script: { title: "", source_text: "", segments: [], characters: [], metadata: {} },
            voice_assignments: {},
            synthesis_config: {},
            audio_assets: {
              latest_task_id: null,
              full_wav_relpath: null,
              full_mp3_relpath: null,
              subtitle_srt_relpath: null,
              subtitle_lrc_relpath: null,
              segments: {},
              full_peaks_relpath: null,
              full_peaks_version: 1,
              full_peaks_levels: [],
              archive_schema_version: 3,
            },
            project_origin: {
              kind: "project_file",
              source_project_id: "src-001",
              project_file_name: "opened.bvtproject.json",
              project_file_fingerprint: "abc",
            },
          }),
        },
      ],
      async () => {
        const fakeFile = new Blob(["{}"], { type: "application/json" });
        const result = await useProjectStore.getState().importProjectFile(fakeFile, {
          fileName: "opened.bvtproject.json",
        });
        assert.equal(result.open_mode, "reused");

        const state = useProjectStore.getState();
        assert.equal(state.currentProject?.id, "p-opened");
        assert.equal(state.currentProjectFileName, "opened.bvtproject.json");
        assert.equal(state.projectSources["p-opened"], "project_file");

        const openedEntries = state.projects.filter((item) => item.id === "p-opened");
        assert.equal(openedEntries.length, 1);
        assert.equal(state.projects.length, 2);
      },
    );
  });
});
