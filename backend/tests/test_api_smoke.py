from __future__ import annotations

import uuid
import unittest
import json
from pathlib import Path
import io
import zipfile

from fastapi.testclient import TestClient

from backend.main import app
from backend.models import VoicePreset
from backend.state import get_app_state_from_app


class ApiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()
        cls.app_state = get_app_state_from_app(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    @staticmethod
    def _build_import_archive(project_payload: dict, presets: list[dict], ref_files: dict[str, bytes] | None = None) -> io.BytesIO:
        archive_bytes = io.BytesIO()
        with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("project/project.json", json.dumps(project_payload, ensure_ascii=False))
            zf.writestr("voices/presets.json", json.dumps(presets, ensure_ascii=False))
            for filename, content in (ref_files or {}).items():
                zf.writestr(f"voices/ref/{filename}", content)
        archive_bytes.seek(0)
        return archive_bytes

    def test_root(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("name", body)
        self.assertEqual(body.get("docs"), "/docs")

    def test_system_status_contains_backends(self) -> None:
        response = self.client.get("/api/v1/system/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("llm_backend", body)
        self.assertIn("tts_backend", body)
        self.assertIn("asr_backend", body)
        self.assertIn("python_executable", body)
        self.assertIn("llama_cpp_available", body)
        self.assertIn("llama_cpp_module_path", body)

    def test_default_prompt(self) -> None:
        response = self.client.get("/api/v1/llm/prompts/default")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("prompt"))

    def test_update_orchestrator_llm_params(self) -> None:
        cfg_path = self.app_state.settings.runtime_config_path
        original_cfg = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else None
        payload = {
            "auto_serial": True,
            "auto_unload_llm_after_parse": True,
            "auto_load_tts_before_synth": True,
            "enable_llama_cpp_think_mode": False,
            "llm_backend": "openai",
            "llm_model_path": "unused-for-openai",
            "llm_api_model": "gpt-4.1-mini",
            "llm_n_ctx": 4096,
            "llm_n_gpu_layers": -1,
            "llm_threads": 8,
            "llm_temperature": 0.35,
            "llm_top_p": 0.92,
            "llm_top_k": 32,
            "llm_min_p": 0.05,
            "llm_presence_penalty": 0.1,
            "llm_repeat_penalty": 1.08,
            "llm_max_tokens": 1536,
            "tts_model_path": "k2-fsa/OmniVoice",
            "tts_device": "cuda:0",
            "asr_model_path": "E:/models/faster-whisper-large-v3",
            "asr_device": "cuda:0",
        }
        try:
            response = self.client.put("/api/v1/system/orchestrator/config", json=payload)
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertFalse(body["enable_llama_cpp_think_mode"])
            self.assertEqual(body["llm_backend"], "openai")
            self.assertEqual(body["llm_api_model"], "gpt-4.1-mini")
            self.assertEqual(body["llm_threads"], 8)
            self.assertEqual(body["asr_model_path"], "E:/models/faster-whisper-large-v3")
            self.assertAlmostEqual(body["llm_temperature"], 0.35, places=6)
            persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
            self.assertFalse(persisted["enable_llama_cpp_think_mode"])
            self.assertEqual(persisted["llm_backend"], "openai")
            self.assertEqual(persisted["llm_threads"], 8)
        finally:
            if original_cfg is None:
                cfg_path.unlink(missing_ok=True)
            else:
                cfg_path.write_text(original_cfg, encoding="utf-8")

    def test_reset_orchestrator_config(self) -> None:
        response = self.client.post("/api/v1/system/orchestrator/config/reset", json={})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("enable_llama_cpp_think_mode", body)
        self.assertIn("llm_backend", body)
        self.assertIn("llm_n_ctx", body)
        self.assertIn("tts_model_path", body)
        self.assertIn("asr_model_path", body)

    def test_load_llm_validation_error(self) -> None:
        response = self.client.post("/api/v1/system/load-llm", json={"n_ctx": "bad-type"})
        self.assertEqual(response.status_code, 422)

    def test_load_tts_validation_error(self) -> None:
        response = self.client.post("/api/v1/system/load-tts", json={"unexpected": "field"})
        self.assertEqual(response.status_code, 422)

    def test_load_llm_partial_update_keeps_existing_config(self) -> None:
        seed = {
            "auto_serial": True,
            "auto_unload_llm_after_parse": True,
            "auto_load_tts_before_synth": True,
            "enable_llama_cpp_think_mode": True,
            "llm_backend": "llama_cpp",
            "llm_model_path": "E:/models/keep-me.gguf",
            "llm_api_model": "seed-model",
            "llm_n_ctx": 6144,
            "llm_n_gpu_layers": -1,
            "llm_threads": 6,
            "llm_temperature": 0.2,
            "llm_top_p": 0.9,
            "llm_top_k": 40,
            "llm_min_p": 0.0,
            "llm_presence_penalty": 0.0,
            "llm_repeat_penalty": 1.0,
            "llm_max_tokens": 2048,
            "tts_model_path": "k2-fsa/OmniVoice",
            "tts_device": "cuda:0",
            "asr_model_path": "base",
            "asr_device": "cuda:0",
        }
        try:
            self.assertEqual(self.client.put("/api/v1/system/orchestrator/config", json=seed).status_code, 200)

            response = self.client.post("/api/v1/system/load-llm", json={"backend": "mock"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json().get("backend"), "mock")

            status = self.client.get("/api/v1/system/status")
            self.assertEqual(status.status_code, 200)
            cfg = status.json().get("config", {})
            self.assertEqual(cfg.get("llm_backend"), "mock")
            self.assertEqual(cfg.get("llm_model_path"), "E:/models/keep-me.gguf")
            self.assertEqual(cfg.get("llm_n_ctx"), 6144)
            self.assertEqual(cfg.get("llm_threads"), 6)
        finally:
            self.client.post("/api/v1/system/orchestrator/config/reset", json={})

    def test_browse_files_allows_data_dir(self) -> None:
        response = self.client.post(
            "/api/v1/system/files/browse",
            json={"path": str(self.app_state.settings.data_dir)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)

    def test_browse_files_rejects_outside_allowed_roots(self) -> None:
        outside = Path(self.app_state.settings.base_dir.anchor or "C:\\").resolve()
        response = self.client.post(
            "/api/v1/system/files/browse",
            json={"path": str(outside)},
        )
        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body["code"], "http_403")

    def test_project_crud(self) -> None:
        name = f"smoke-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]

        fetched = self.client.get(f"/api/v1/projects/{project_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["name"], name)

        deleted = self.client.delete(f"/api/v1/projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["status"], "deleted")

    def test_transcribe_missing_file_returns_404(self) -> None:
        response = self.client.post(
            "/api/v1/voices/transcribe",
            json={"audio_path": "E:/softs/BeautyVoiceTTS/backend/data/voices/not_exists.wav"},
        )
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body["code"], "http_404")
        self.assertIn("message", body)
        self.assertEqual(body["path"], "/api/v1/voices/transcribe")

    def test_validation_error_schema(self) -> None:
        response = self.client.post("/api/v1/voices/transcribe", json={})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["code"], "validation_error")
        self.assertEqual(body["message"], "请求参数校验失败")
        self.assertIsInstance(body["details"], list)
        self.assertEqual(body["path"], "/api/v1/voices/transcribe")

    def test_create_preset_still_works_with_corrupted_preset_file(self) -> None:
        original = ""
        existed = self.app_state.voice_manager.presets_file.exists()
        if existed:
            original = self.app_state.voice_manager.presets_file.read_text(encoding="utf-8")
        try:
            self.app_state.voice_manager.presets_file.write_text("{not-json", encoding="utf-8")
            response = self.client.post(
                "/api/v1/voices/presets",
                json={
                    "name": f"recover-{uuid.uuid4().hex[:6]}",
                    "voice_mode": "design",
                    "description": "recover from broken json",
                    "gender": "female",
                    "style": "calm",
                    "speed": 1.0,
                },
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["voice_mode"], "design")
            self.assertTrue(body["id"])
        finally:
            if existed:
                self.app_state.voice_manager.presets_file.write_text(original, encoding="utf-8")
            else:
                self.app_state.voice_manager.presets_file.unlink(missing_ok=True)

    def test_reorder_voice_presets(self) -> None:
        original = ""
        existed = self.app_state.voice_manager.presets_file.exists()
        if existed:
            original = self.app_state.voice_manager.presets_file.read_text(encoding="utf-8")

        try:
            self.app_state.voice_manager.save_presets([])
            created_ids: list[str] = []
            for name in ["preset-a", "preset-b", "preset-c"]:
                created = self.client.post(
                    "/api/v1/voices/presets",
                    json={
                        "name": name,
                        "voice_mode": "design",
                        "description": name,
                        "gender": "female",
                        "style": "calm",
                        "speed": 1.0,
                    },
                )
                self.assertEqual(created.status_code, 200)
                created_ids.append(created.json()["id"])

            reordered_ids = [created_ids[2], created_ids[0], created_ids[1]]
            reordered = self.client.post(
                "/api/v1/voices/presets/reorder",
                json={"preset_ids": reordered_ids},
            )
            self.assertEqual(reordered.status_code, 200)
            self.assertEqual([item["id"] for item in reordered.json()], reordered_ids)

            listed = self.client.get("/api/v1/voices/presets")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual([item["id"] for item in listed.json()], reordered_ids)
        finally:
            if existed:
                self.app_state.voice_manager.presets_file.write_text(original, encoding="utf-8")
            else:
                self.app_state.voice_manager.presets_file.unlink(missing_ok=True)

    def test_import_archive_invalid_zip_returns_400(self) -> None:
        response = self.client.post(
            "/api/v1/projects/import/archive",
            files={"file": ("bad.zip", io.BytesIO(b"not-a-zip"), "application/zip")},
        )
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["code"], "http_400")

    def test_import_archive_v1_layout_supported(self) -> None:
        name = f"legacy-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": name})
        self.assertEqual(created.status_code, 200)
        source_project = created.json()
        source_id = source_project["id"]
        try:
            script_update = self.client.put(
                f"/api/v1/projects/{source_id}/script",
                json={
                    "title": "legacy-script",
                    "source_text": "旁白：测试",
                    "segments": [
                        {"id": "seg-legacy-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "测试"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(script_update.status_code, 200)
            project_full = self.client.get(f"/api/v1/projects/{source_id}").json()

            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("project.json", json.dumps(project_full, ensure_ascii=False))
                zf.writestr(f"audio/{source_id}.wav", b"RIFFdemo")
                zf.writestr("segments/seg-legacy-1.wav", b"RIFFdemo")
                zf.writestr(f"{source_id}.srt", "1\n00:00:00,000 --> 00:00:01,000\n测试\n")
            archive_bytes.seek(0)

            response = self.client.post(
                "/api/v1/projects/import/archive",
                files={"file": ("legacy.zip", archive_bytes, "application/zip")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertTrue(body["project_id"])
            self.assertEqual(body["from_project_id"], source_id)
            self.assertEqual(body["project_name"], project_full["name"])
            self.assertEqual(body["import_source"], "archive_import")
            self.assertGreaterEqual(body["imported_segments"], 1)
            warning_text = " | ".join(body.get("warnings", []))
            self.assertIn("legacy archive layout", warning_text)
            self.assertIn("voices/presets.json", warning_text)
        finally:
            self.client.delete(f"/api/v1/projects/{source_id}")

    def test_import_archive_reuses_existing_preset_and_ref_audio(self) -> None:
        presets_file = self.app_state.voice_manager.presets_file
        presets_backup = presets_file.read_text(encoding="utf-8") if presets_file.exists() else None
        existing_ref_path = self.app_state.settings.voices_dir / f"existing-ref-{uuid.uuid4().hex[:6]}.wav"
        source_id = None
        imported_project_id = None
        try:
            existing_ref_bytes = b"RIFFexisting-audio"
            existing_ref_path.write_bytes(existing_ref_bytes)
            existing_preset_id = f"existing-{uuid.uuid4().hex[:8]}"
            self.app_state.voice_manager.save_presets(
                [
                    VoicePreset(
                        id=existing_preset_id,
                        name="Warm Female",
                        voice_mode="design",
                        ref_audio_path=str(existing_ref_path),
                        ref_text="示例台词",
                        gender="female",
                        style="warm",
                        speed=1.0,
                        description="warm-desc",
                    )
                ]
            )

            created = self.client.post("/api/v1/projects", json={"name": f"import-src-{uuid.uuid4().hex[:6]}"})
            self.assertEqual(created.status_code, 200)
            source_id = created.json()["id"]

            script_update = self.client.put(
                f"/api/v1/projects/{source_id}/script",
                json={
                    "title": "import-script",
                    "source_text": "角色A：测试",
                    "segments": [
                        {"id": "seg-import-1", "index": 0, "type": "dialogue", "speaker": "角色A", "text": "测试"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(script_update.status_code, 200)
            self.assertEqual(
                self.client.put(
                    f"/api/v1/projects/{source_id}/voice-assignments",
                    json={"assignments": {"角色A": "archive-preset-1"}},
                ).status_code,
                200,
            )
            source_project = self.client.get(f"/api/v1/projects/{source_id}").json()
            archive = self._build_import_archive(
                source_project,
                [
                    {
                        "id": "archive-preset-1",
                        "name": "Warm Female",
                        "voice_mode": "design",
                        "ref_audio_path": "warm.wav",
                        "ref_text": "示例台词",
                        "gender": "female",
                        "style": "warm",
                        "speed": 1.0,
                        "description": "warm-desc",
                    }
                ],
                {"warm.wav": existing_ref_bytes},
            )
            response = self.client.post(
                "/api/v1/projects/import/archive",
                files={"file": ("import.zip", archive, "application/zip")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            imported_project_id = body["project_id"]
            self.assertEqual(body["created_presets"], 0)
            self.assertEqual(body["reused_presets"], 1)
            self.assertEqual(body["reused_ref_audios"], 1)
            self.assertEqual(body["copied_ref_audios"], 0)

            imported_project = self.client.get(f"/api/v1/projects/{imported_project_id}").json()
            self.assertEqual(imported_project["voice_assignments"].get("角色A"), existing_preset_id)
            self.assertEqual(len(self.app_state.voice_manager.list_presets()), 1)
        finally:
            if imported_project_id:
                self.client.delete(f"/api/v1/projects/{imported_project_id}")
            if source_id:
                self.client.delete(f"/api/v1/projects/{source_id}")
            existing_ref_path.unlink(missing_ok=True)
            if presets_backup is None:
                presets_file.unlink(missing_ok=True)
            else:
                presets_file.write_text(presets_backup, encoding="utf-8")

    def test_import_archive_repeat_does_not_keep_creating_presets(self) -> None:
        presets_file = self.app_state.voice_manager.presets_file
        presets_backup = presets_file.read_text(encoding="utf-8") if presets_file.exists() else None
        source_id = None
        imported_project_ids: list[str] = []
        try:
            self.app_state.voice_manager.save_presets([])

            created = self.client.post("/api/v1/projects", json={"name": f"import-repeat-{uuid.uuid4().hex[:6]}"})
            self.assertEqual(created.status_code, 200)
            source_id = created.json()["id"]

            script_update = self.client.put(
                f"/api/v1/projects/{source_id}/script",
                json={
                    "title": "repeat-script",
                    "source_text": "角色A：测试",
                    "segments": [
                        {"id": "seg-repeat-1", "index": 0, "type": "dialogue", "speaker": "角色A", "text": "测试"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(script_update.status_code, 200)
            self.assertEqual(
                self.client.put(
                    f"/api/v1/projects/{source_id}/voice-assignments",
                    json={"assignments": {"角色A": "archive-repeat-1"}},
                ).status_code,
                200,
            )
            source_project = self.client.get(f"/api/v1/projects/{source_id}").json()
            archive = self._build_import_archive(
                source_project,
                [
                    {
                        "id": "archive-repeat-1",
                        "name": "Repeat Voice",
                        "voice_mode": "design",
                        "gender": "female",
                        "style": "calm",
                        "speed": 1.0,
                        "description": "repeat-desc",
                    }
                ],
            )

            first = self.client.post(
                "/api/v1/projects/import/archive",
                files={"file": ("repeat.zip", archive, "application/zip")},
            )
            self.assertEqual(first.status_code, 200)
            first_body = first.json()
            imported_project_ids.append(first_body["project_id"])
            self.assertEqual(first_body["created_presets"], 1)
            self.assertEqual(first_body["reused_presets"], 0)
            created_preset_id = self.client.get(f"/api/v1/projects/{first_body['project_id']}").json()["voice_assignments"]["角色A"]
            preset_count_after_first = len(self.app_state.voice_manager.list_presets())

            archive.seek(0)
            second = self.client.post(
                "/api/v1/projects/import/archive",
                files={"file": ("repeat.zip", archive, "application/zip")},
            )
            self.assertEqual(second.status_code, 200)
            second_body = second.json()
            imported_project_ids.append(second_body["project_id"])
            self.assertEqual(second_body["created_presets"], 0)
            self.assertEqual(second_body["reused_presets"], 1)
            self.assertEqual(len(self.app_state.voice_manager.list_presets()), preset_count_after_first)

            second_project = self.client.get(f"/api/v1/projects/{second_body['project_id']}").json()
            self.assertEqual(second_project["voice_assignments"]["角色A"], created_preset_id)
        finally:
            for project_id in imported_project_ids:
                self.client.delete(f"/api/v1/projects/{project_id}")
            if source_id:
                self.client.delete(f"/api/v1/projects/{source_id}")
            if presets_backup is None:
                presets_file.unlink(missing_ok=True)
            else:
                presets_file.write_text(presets_backup, encoding="utf-8")

    def test_export_and_import_project_file(self) -> None:
        created = self.client.post("/api/v1/projects", json={"name": f"project-file-{uuid.uuid4().hex[:6]}"})
        self.assertEqual(created.status_code, 200)
        source_id = created.json()["id"]
        imported_id = None
        try:
            update_script = self.client.put(
                f"/api/v1/projects/{source_id}/script",
                json={
                    "title": "project-file-title",
                    "source_text": "旁白：这是轻量项目文件测试文本。",
                    "segments": [
                        {"id": "seg-pf-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "测试片段"},
                    ],
                    "characters": [],
                    "metadata": {"tag": "project-file"},
                },
            )
            self.assertEqual(update_script.status_code, 200)
            assign_resp = self.client.put(
                f"/api/v1/projects/{source_id}/voice-assignments",
                json={"assignments": {"narrator": "preset-001"}},
            )
            self.assertEqual(assign_resp.status_code, 200)

            export_resp = self.client.get(f"/api/v1/projects/{source_id}/export/project-file")
            self.assertEqual(export_resp.status_code, 200)
            self.assertEqual(export_resp.headers.get("x-bvt-project-file"), "1")
            exported = export_resp.json()
            self.assertEqual(exported["file_type"], "beautyvoice_project")
            self.assertEqual(exported["schema_version"], 1)
            self.assertEqual(exported["project"]["name"], created.json()["name"])
            self.assertEqual(exported["script"]["source_text"], "旁白：这是轻量项目文件测试文本。")

            file_bytes = io.BytesIO(json.dumps(exported, ensure_ascii=False).encode("utf-8"))
            import_resp = self.client.post(
                "/api/v1/projects/import/project-file",
                files={"file": ("project.bvtproject.json", file_bytes, "application/json")},
            )
            self.assertEqual(import_resp.status_code, 200)
            import_body = import_resp.json()
            imported_id = import_body["project_id"]
            self.assertNotEqual(imported_id, source_id)
            self.assertEqual(import_body["project_name"], created.json()["name"])
            self.assertEqual(import_body["import_source"], "project_file")

            imported_project = self.client.get(f"/api/v1/projects/{imported_id}")
            self.assertEqual(imported_project.status_code, 200)
            body = imported_project.json()
            self.assertEqual(body["name"], created.json()["name"])
            self.assertEqual(body["script"]["source_text"], "旁白：这是轻量项目文件测试文本。")
            self.assertEqual(len(body["script"]["segments"]), 1)
            self.assertEqual(body["voice_assignments"].get("narrator"), "preset-001")
            self.assertIsNone(body["audio_assets"]["full_wav_relpath"])
            self.assertIsNone(body["audio_assets"]["full_mp3_relpath"])
            self.assertEqual(body["audio_assets"]["segments"], {})
        finally:
            if imported_id:
                self.client.delete(f"/api/v1/projects/{imported_id}")
            self.client.delete(f"/api/v1/projects/{source_id}")

    def test_partial_synthesis_requires_segment_ids(self) -> None:
        project_name = f"partial-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": project_name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]
        try:
            response = self.client.post(
                "/api/v1/tts/synthesize/segments",
                json={"project_id": project_id, "config": {"output_format": "wav"}},
            )
            self.assertEqual(response.status_code, 400)
            body = response.json()
            self.assertEqual(body["code"], "http_400")
        finally:
            self.client.delete(f"/api/v1/projects/{project_id}")

    def test_stale_report_marks_missing_and_stale_segments(self) -> None:
        project_name = f"stale-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": project_name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]
        try:
            update = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "stale",
                    "source_text": "stale",
                    "segments": [
                        {"id": "seg-stale-a", "index": 0, "type": "narration", "speaker": "narrator", "text": "A"},
                        {"id": "seg-stale-b", "index": 1, "type": "narration", "speaker": "narrator", "text": "B"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(update.status_code, 200)

            project_resp = self.client.get(f"/api/v1/projects/{project_id}")
            self.assertEqual(project_resp.status_code, 200)
            project = project_resp.json()

            project_seg_dir = self.app_state.settings.output_dir / "projects" / project_id / "segments"
            project_seg_dir.mkdir(parents=True, exist_ok=True)
            seg_a = project_seg_dir / "seg-stale-a.wav"
            seg_a.write_bytes(b"RIFFdemo")

            project["audio_assets"]["segments"] = {
                "seg-stale-a": {
                    "segment_id": "seg-stale-a",
                    "audio_relpath": f"projects/{project_id}/segments/seg-stale-a.wav",
                    "duration_ms": 1000,
                    "fingerprint": "mismatch",
                    "source_text": "OLD-TEXT",
                    "source_speaker": "narrator",
                    "source_type": "narration",
                    "source_emotion": "neutral",
                    "source_tts_overrides": {},
                    "source_voice_preset_id": None,
                    "source_preset_hash": "",
                    "source_config_hash": "",
                    "source_tts_backend": "",
                    "source_tts_model_path": "",
                    "source_task_id": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "status": "ready",
                }
            }
            saved = self.client.put(f"/api/v1/projects/{project_id}", json=project)
            self.assertEqual(saved.status_code, 200)

            report_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/stale-report")
            self.assertEqual(report_resp.status_code, 200)
            report = report_resp.json()
            self.assertEqual(report["total"], 2)
            self.assertIn("seg-stale-b", report["missing_segment_ids"])
            self.assertIn("seg-stale-a", report["stale_segment_ids"])
            by_id = {item["segment_id"]: item for item in report["items"]}
            self.assertIn("missing_audio", by_id["seg-stale-b"]["reasons"])
            self.assertIn("text_changed", by_id["seg-stale-a"]["reasons"])
        finally:
            self.client.delete(f"/api/v1/projects/{project_id}")

    def test_stale_report_ready_when_fingerprint_matches_current_preset(self) -> None:
        project_name = f"stale-fingerprint-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": project_name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]

        presets_file = self.app_state.voice_manager.presets_file
        presets_backup = presets_file.read_text(encoding="utf-8") if presets_file.exists() else None

        try:
            script_update = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "stale-fingerprint",
                    "source_text": "stale-fingerprint",
                    "segments": [
                        {"id": "seg-fingerprint-a", "index": 0, "type": "dialogue", "speaker": "角色A", "text": "测试"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(script_update.status_code, 200)

            preset_resp = self.client.post(
                "/api/v1/voices/presets",
                json={
                    "name": f"preset-{uuid.uuid4().hex[:6]}",
                    "voice_mode": "design",
                    "description": "for stale fingerprint regression",
                    "gender": "female",
                    "style": "calm",
                    "speed": 1.0,
                },
            )
            self.assertEqual(preset_resp.status_code, 200)
            preset_id = preset_resp.json()["id"]

            project = self.client.get(f"/api/v1/projects/{project_id}").json()
            project["voice_assignments"] = {"角色A": preset_id}
            saved_project = self.client.put(f"/api/v1/projects/{project_id}", json=project)
            self.assertEqual(saved_project.status_code, 200)

            initial_report = self.client.get(f"/api/v1/tts/projects/{project_id}/stale-report")
            self.assertEqual(initial_report.status_code, 200)
            expected_fingerprint = initial_report.json()["items"][0]["expected_fingerprint"]

            project_seg_dir = self.app_state.settings.output_dir / "projects" / project_id / "segments"
            project_seg_dir.mkdir(parents=True, exist_ok=True)
            seg_path = project_seg_dir / "seg-fingerprint-a.wav"
            seg_path.write_bytes(b"RIFFdemo")

            project = self.client.get(f"/api/v1/projects/{project_id}").json()
            project["audio_assets"]["segments"] = {
                "seg-fingerprint-a": {
                    "segment_id": "seg-fingerprint-a",
                    "audio_relpath": f"projects/{project_id}/segments/seg-fingerprint-a.wav",
                    "duration_ms": 1000,
                    "fingerprint": expected_fingerprint,
                    "source_text": "测试",
                    "source_speaker": "角色A",
                    "source_type": "dialogue",
                    "source_emotion": "neutral",
                    "source_tts_overrides": {},
                    "source_voice_preset_id": "old-preset-id",
                    "source_preset_hash": "old-preset-hash",
                    "source_config_hash": "",
                    "source_tts_backend": "",
                    "source_tts_model_path": "",
                    "source_task_id": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "status": "ready",
                }
            }
            saved = self.client.put(f"/api/v1/projects/{project_id}", json=project)
            self.assertEqual(saved.status_code, 200)

            report_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/stale-report")
            self.assertEqual(report_resp.status_code, 200)
            report = report_resp.json()
            self.assertEqual(report["stale_count"], 0)
            self.assertIn("seg-fingerprint-a", report["ready_segment_ids"])
            item = report["items"][0]
            self.assertEqual(item["status"], "ready")
            self.assertEqual(item["current_fingerprint"], item["expected_fingerprint"])
            self.assertNotIn("voice_assignment_changed", item["reasons"])
            self.assertNotIn("preset_changed", item["reasons"])
        finally:
            if presets_backup is None:
                presets_file.unlink(missing_ok=True)
            else:
                presets_file.write_text(presets_backup, encoding="utf-8")
            self.client.delete(f"/api/v1/projects/{project_id}")

    def test_stale_report_exposes_segment_field_change_reasons(self) -> None:
        project_name = f"stale-fields-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": project_name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]
        try:
            script_update = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "stale-fields",
                    "source_text": "stale-fields",
                    "segments": [
                        {
                            "id": "seg-fields-a",
                            "index": 0,
                            "type": "dialogue",
                            "speaker": "角色A",
                            "text": "新文本",
                            "emotion": "cheerful",
                            "non_verbal": ["laugh"],
                            "tts_overrides": {"speed": 1.1},
                        },
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(script_update.status_code, 200)

            project_seg_dir = self.app_state.settings.output_dir / "projects" / project_id / "segments"
            project_seg_dir.mkdir(parents=True, exist_ok=True)
            seg_path = project_seg_dir / "seg-fields-a.wav"
            seg_path.write_bytes(b"RIFFdemo")

            project = self.client.get(f"/api/v1/projects/{project_id}").json()
            project["audio_assets"]["segments"] = {
                "seg-fields-a": {
                    "segment_id": "seg-fields-a",
                    "audio_relpath": f"projects/{project_id}/segments/seg-fields-a.wav",
                    "duration_ms": 1000,
                    "fingerprint": "legacy-fingerprint",
                    "source_text": "旧文本",
                    "source_speaker": "角色B",
                    "source_type": "narration",
                    "source_emotion": "neutral",
                    "source_tts_overrides": {},
                    "source_voice_preset_id": None,
                    "source_preset_hash": "",
                    "source_config_hash": "",
                    "source_tts_backend": "",
                    "source_tts_model_path": "",
                    "source_task_id": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "status": "ready",
                }
            }
            saved = self.client.put(f"/api/v1/projects/{project_id}", json=project)
            self.assertEqual(saved.status_code, 200)

            report_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/stale-report")
            self.assertEqual(report_resp.status_code, 200)
            report = report_resp.json()
            self.assertEqual(report["stale_count"], 1)
            item = report["items"][0]
            self.assertEqual(item["segment_id"], "seg-fields-a")
            self.assertEqual(item["status"], "stale")
            self.assertIn("text_changed", item["reasons"])
            self.assertIn("speaker_changed", item["reasons"])
            self.assertIn("type_changed", item["reasons"])
            self.assertIn("emotion_changed", item["reasons"])
            self.assertIn("tts_overrides_changed", item["reasons"])
        finally:
            self.client.delete(f"/api/v1/projects/{project_id}")

    def test_update_script_invalidates_legacy_segment_asset_when_text_changes(self) -> None:
        project_name = f"stale-legacy-update-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": project_name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]
        try:
            initial = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "legacy-invalidate",
                    "source_text": "legacy-invalidate",
                    "segments": [
                        {"id": "seg-legacy-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "旧文本"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(initial.status_code, 200)

            project_seg_dir = self.app_state.settings.output_dir / "projects" / project_id / "segments"
            project_seg_dir.mkdir(parents=True, exist_ok=True)
            seg_path = project_seg_dir / "seg-legacy-1.wav"
            seg_path.write_bytes(b"RIFFdemo")

            project = self.client.get(f"/api/v1/projects/{project_id}").json()
            project["audio_assets"]["segments"] = {
                "seg-legacy-1": {
                    "segment_id": "seg-legacy-1",
                    "audio_relpath": f"projects/{project_id}/segments/seg-legacy-1.wav",
                    "duration_ms": 1000,
                    "fingerprint": "",
                    "source_text": "",
                    "source_speaker": "",
                    "source_type": "",
                    "source_emotion": "",
                    "source_tts_overrides": {},
                    "source_voice_preset_id": None,
                    "source_preset_hash": "",
                    "source_config_hash": "",
                    "source_tts_backend": "",
                    "source_tts_model_path": "",
                    "source_task_id": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "status": "ready",
                }
            }
            saved = self.client.put(f"/api/v1/projects/{project_id}", json=project)
            self.assertEqual(saved.status_code, 200)

            changed = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "legacy-invalidate",
                    "source_text": "legacy-invalidate",
                    "segments": [
                        {"id": "seg-legacy-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "新文本"},
                    ],
                    "characters": [],
                    "metadata": {},
                },
            )
            self.assertEqual(changed.status_code, 200)

            report_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/stale-report")
            self.assertEqual(report_resp.status_code, 200)
            report = report_resp.json()
            self.assertIn("seg-legacy-1", report["missing_segment_ids"])
            by_id = {item["segment_id"]: item for item in report["items"]}
            self.assertIn("missing_audio", by_id["seg-legacy-1"]["reasons"])
        finally:
            self.client.delete(f"/api/v1/projects/{project_id}")


if __name__ == "__main__":
    unittest.main()
