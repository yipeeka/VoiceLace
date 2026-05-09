from __future__ import annotations

import uuid
import unittest
import json
import asyncio
import time
import threading
from pathlib import Path
import io
import zipfile

from fastapi.testclient import TestClient
from backend.api import asr_routes

from backend.main import app
from backend.models import Project, ProjectOrigin, VoicePreset
from backend.persistence import load_project, save_project
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
        self.assertIn("music_backend", body)
        self.assertIn("music_status", body)
        self.assertIn("llm_think_mode_effective", body)
        self.assertIn("llm_think_mode_support", body)
        self.assertIn("llm_load_mode", body)
        self.assertIn("asr_backend", body)
        self.assertIn("python_executable", body)
        self.assertIn("llama_cpp_available", body)
        self.assertIn("llama_cpp_module_path", body)
        self.assertIn("pyannote_model_id", body)
        self.assertIn("pyannote_loaded", body)
        self.assertIn("pyannote_error", body)
        self.assertIn("pyannote_available", body)
        self.assertIn("music_enabled", body.get("config", {}))
        self.assertIn("music_turbo_model_dir", body.get("config", {}))
        self.assertIn("music_base_model_dir", body.get("config", {}))
        self.assertIn("music_model_variant", body.get("config", {}))

    def test_music_model_validate_endpoint_shape(self) -> None:
        response = self.client.get("/api/v1/music/model/validate")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("valid", body)
        self.assertIn("model_dir", body)
        self.assertIn("exists", body)
        self.assertIn("missing", body)
        self.assertIn("message", body)
        self.assertIn("is_turbo", body)
        self.assertIn("supports_lego_complete", body)
        self.assertIn("model_variant", body)
        self.assertIn("music_turbo_model_dir", body)
        self.assertIn("music_base_model_dir", body)
        self.assertIn("supported_task_types", body)
        self.assertIn("music_enabled", body)
        self.assertIn("device_mode", body)
        self.assertIsInstance(body.get("missing"), list)
        self.assertIsInstance(body.get("supported_task_types"), list)

    def test_music_asset_audio_and_attach_flow(self) -> None:
        project_id = ""
        created_asset: Path | None = None
        bound_relpath = ""
        try:
            music_dir = self.app_state.settings.output_dir / "music"
            music_dir.mkdir(parents=True, exist_ok=True)
            asset_name = f"smoke_music_{uuid.uuid4().hex[:8]}.wav"
            created_asset = music_dir / asset_name
            created_asset.write_bytes(b"RIFFdemo")

            list_resp = self.client.get("/api/v1/music/assets")
            self.assertEqual(list_resp.status_code, 200)
            items = list_resp.json().get("items", [])
            self.assertTrue(any(item.get("name") == asset_name for item in items))

            audio_resp = self.client.get(f"/api/v1/music/assets/{asset_name}/audio")
            self.assertEqual(audio_resp.status_code, 200)
            self.assertEqual(audio_resp.headers.get("content-type"), "audio/wav")
            self.assertEqual(audio_resp.content, b"RIFFdemo")

            delete_resp = self.client.delete(f"/api/v1/music/assets/{asset_name}")
            self.assertEqual(delete_resp.status_code, 200)
            self.assertEqual(delete_resp.json().get("status"), "deleted")

            missing_resp = self.client.get(f"/api/v1/music/assets/{asset_name}/audio")
            self.assertEqual(missing_resp.status_code, 404)

            created_asset.write_bytes(b"RIFFdemo")

            create_resp = self.client.post("/api/v1/projects", json={"name": f"music-attach-{uuid.uuid4().hex[:8]}"})
            self.assertEqual(create_resp.status_code, 200)
            project_id = create_resp.json()["id"]

            attach_resp = self.client.post(
                "/api/v1/music/assets/attach",
                json={
                    "project_id": project_id,
                    "asset_name": asset_name,
                    "target": "bgm",
                },
            )
            self.assertEqual(attach_resp.status_code, 200)
            attach_body = attach_resp.json()
            self.assertEqual(attach_body.get("asset_type"), "bgm")
            bound_relpath = str(attach_body.get("relpath") or "")
            self.assertTrue(bound_relpath)

            project_resp = self.client.get(f"/api/v1/projects/{project_id}")
            self.assertEqual(project_resp.status_code, 200)
            project = project_resp.json()
            self.assertEqual(project["synthesis_config"]["bgm_track"]["relpath"], bound_relpath)

            bound_path = self.app_state.settings.output_dir / bound_relpath
            self.assertTrue(bound_path.exists())
            self.assertTrue(bound_path.is_file())
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")
            if created_asset and created_asset.exists():
                created_asset.unlink(missing_ok=True)

    def test_music_asset_upload_endpoint(self) -> None:
        uploaded_name = ""
        try:
            upload_resp = self.client.post(
                "/api/v1/music/assets/upload",
                files={"file": ("upload_demo.mp3", b"ID3demo", "audio/mpeg")},
            )
            self.assertEqual(upload_resp.status_code, 200)
            body = upload_resp.json()
            uploaded_name = str(body.get("name") or "")
            self.assertTrue(uploaded_name.endswith(".mp3"))

            list_resp = self.client.get("/api/v1/music/assets")
            self.assertEqual(list_resp.status_code, 200)
            items = list_resp.json().get("items", [])
            self.assertTrue(any(item.get("name") == uploaded_name for item in items))
        finally:
            if uploaded_name:
                self.client.delete(f"/api/v1/music/assets/{uploaded_name}")

    def test_music_asset_rename_endpoint(self) -> None:
        source_name = ""
        renamed_name = ""
        try:
            upload_resp = self.client.post(
                "/api/v1/music/assets/upload",
                files={"file": ("rename_demo.wav", b"RIFFrename", "audio/wav")},
            )
            self.assertEqual(upload_resp.status_code, 200)
            source_name = str(upload_resp.json().get("name") or "")
            self.assertTrue(source_name.endswith(".wav"))

            rename_resp = self.client.post(
                f"/api/v1/music/assets/{source_name}/rename",
                json={"new_name": "renamed_asset.wav"},
            )
            self.assertEqual(rename_resp.status_code, 200)
            body = rename_resp.json()
            self.assertEqual(body.get("status"), "renamed")
            self.assertEqual(body.get("old_name"), source_name)
            renamed_name = str(body.get("name") or "")
            self.assertEqual(renamed_name, "renamed_asset.wav")

            list_resp = self.client.get("/api/v1/music/assets")
            self.assertEqual(list_resp.status_code, 200)
            items = list_resp.json().get("items", [])
            self.assertTrue(any(item.get("name") == renamed_name for item in items))
            self.assertFalse(any(item.get("name") == source_name for item in items))
        finally:
            if source_name:
                self.client.delete(f"/api/v1/music/assets/{source_name}")
            if renamed_name:
                self.client.delete(f"/api/v1/music/assets/{renamed_name}")

    def test_music_asset_category_crud_flow(self) -> None:
        music_dir = self.app_state.settings.output_dir / "music"
        music_dir.mkdir(parents=True, exist_ok=True)
        asset_name = f"cat_asset_{uuid.uuid4().hex[:8]}.wav"
        asset_path = music_dir / asset_name
        created_category_id = ""
        try:
            asset_path.write_bytes(b"RIFFcat")

            create_resp = self.client.post("/api/v1/music/assets/categories", json={"name": "测试分类"})
            self.assertEqual(create_resp.status_code, 200)
            created_category_id = str((create_resp.json().get("category") or {}).get("id") or "")
            self.assertTrue(created_category_id)

            assign_resp = self.client.post(
                f"/api/v1/music/assets/{asset_name}/category",
                json={"category_id": created_category_id},
            )
            self.assertEqual(assign_resp.status_code, 200)
            self.assertEqual(assign_resp.json().get("category_id"), created_category_id)

            list_resp = self.client.get("/api/v1/music/assets")
            self.assertEqual(list_resp.status_code, 200)
            body = list_resp.json()
            categories = body.get("categories") or []
            items = body.get("items") or []
            self.assertTrue(any(item.get("id") == "uncategorized" for item in categories))
            self.assertTrue(any(item.get("id") == created_category_id for item in categories))
            target = next((item for item in items if item.get("name") == asset_name), None)
            self.assertIsNotNone(target)
            self.assertEqual(target.get("category_id"), created_category_id)
            self.assertEqual(target.get("category_name"), "测试分类")

            rename_resp = self.client.post(
                f"/api/v1/music/assets/categories/{created_category_id}/rename",
                json={"name": "测试分类-已改名"},
            )
            self.assertEqual(rename_resp.status_code, 200)
            renamed = rename_resp.json().get("category") or {}
            self.assertEqual(renamed.get("id"), created_category_id)
            self.assertEqual(renamed.get("name"), "测试分类-已改名")

            unassign_resp = self.client.post(
                f"/api/v1/music/assets/{asset_name}/category",
                json={"category_id": None},
            )
            self.assertEqual(unassign_resp.status_code, 200)
            self.assertEqual(unassign_resp.json().get("category_id"), "uncategorized")

            delete_resp = self.client.delete(f"/api/v1/music/assets/categories/{created_category_id}")
            self.assertEqual(delete_resp.status_code, 200)
            self.assertEqual(delete_resp.json().get("status"), "deleted")
            created_category_id = ""
        finally:
            if created_category_id:
                self.client.delete(f"/api/v1/music/assets/categories/{created_category_id}")
            self.client.delete(f"/api/v1/music/assets/{asset_name}")
            if asset_path.exists():
                asset_path.unlink(missing_ok=True)

    def test_music_generate_cover_requires_source_asset(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        try:
            state.orchestrator.config.music_enabled = True
            response = self.client.post(
                "/api/v1/music/generate",
                json={
                    "task_type": "cover",
                    "prompt": "cover style track",
                    "audio_duration": 10,
                    "vocal_language": "unknown",
                    "num_inference_steps": 8,
                },
            )
            self.assertEqual(response.status_code, 400)
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled

    def test_music_generate_base_only_tasks_rejected_on_turbo_model(self) -> None:
        from backend.engine.music_engine import MusicEngine

        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_validator = MusicEngine.validate_model_dir
        source_name = f"turbo_mode_src_{uuid.uuid4().hex[:8]}.wav"
        source_path = state.settings.output_dir / "music" / source_name
        try:
            state.orchestrator.config.music_enabled = True
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_bytes(b"RIFFturbo")

            def fake_validate_model_dir(_model_dir: str) -> dict:
                return {
                    "valid": True,
                    "model_dir": "D:/fake/turbo",
                    "exists": True,
                    "missing": [],
                    "message": "",
                    "is_turbo": True,
                    "supports_lego_complete": False,
                }

            MusicEngine.validate_model_dir = staticmethod(fake_validate_model_dir)

            for task_type in ("lego", "extract", "complete"):
                with self.subTest(task_type=task_type):
                    payload = {
                        "task_type": task_type,
                        "prompt": f"{task_type} test",
                        "audio_duration": 10,
                        "vocal_language": "unknown",
                        "num_inference_steps": 8,
                        "source_asset_name": source_name,
                    }
                    if task_type in {"lego", "extract"}:
                        payload["track_name"] = "drums"
                    response = self.client.post("/api/v1/music/generate", json=payload)
                    self.assertEqual(response.status_code, 400)
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled
            MusicEngine.validate_model_dir = original_validator
            source_path.unlink(missing_ok=True)

    def test_music_model_validate_supported_task_types_for_turbo(self) -> None:
        from backend.engine.music_engine import MusicEngine

        original_validator = MusicEngine.validate_model_dir
        try:
            def fake_validate_model_dir(_model_dir: str) -> dict:
                return {
                    "valid": True,
                    "model_dir": "D:/fake/turbo",
                    "exists": True,
                    "missing": [],
                    "message": "",
                    "is_turbo": True,
                    "supports_lego_complete": False,
                }

            MusicEngine.validate_model_dir = staticmethod(fake_validate_model_dir)
            response = self.client.get("/api/v1/music/model/validate")
            self.assertEqual(response.status_code, 200)
            body = response.json()
            supported = body.get("supported_task_types", [])
            self.assertIn("text2music", supported)
            self.assertIn("cover", supported)
            self.assertIn("repaint", supported)
            self.assertNotIn("extract", supported)
            self.assertNotIn("lego", supported)
            self.assertNotIn("complete", supported)
        finally:
            MusicEngine.validate_model_dir = original_validator

    def test_music_model_select_updates_variant(self) -> None:
        state = self.app_state
        original_variant = state.orchestrator.config.music_model_variant
        try:
            response = self.client.post("/api/v1/music/model/select", json={"model_variant": "base"})
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body.get("status"), "ok")
            self.assertEqual(body.get("model_variant"), "base")
            self.assertIn("supported_task_types", body)
            self.assertEqual(state.orchestrator.config.music_model_variant, "base")
        finally:
            state.orchestrator.config.music_model_variant = original_variant

    def test_tts_postprocess_asset_preview_endpoint(self) -> None:
        project_id = ""
        try:
            create_resp = self.client.post("/api/v1/projects", json={"name": f"tts-post-preview-{uuid.uuid4().hex[:8]}"})
            self.assertEqual(create_resp.status_code, 200)
            project_id = create_resp.json()["id"]

            upload_resp = self.client.post(
                f"/api/v1/tts/projects/{project_id}/postprocess/assets?type=bgm",
                files={"file": ("demo.wav", b"RIFFdemo", "audio/wav")},
            )
            self.assertEqual(upload_resp.status_code, 200)
            relpath = str(upload_resp.json().get("relpath") or "")
            self.assertTrue(relpath)

            preview_resp = self.client.get(
                f"/api/v1/tts/projects/{project_id}/postprocess/assets/preview?type=bgm"
            )
            self.assertEqual(preview_resp.status_code, 200)
            self.assertTrue((preview_resp.headers.get("content-type") or "").startswith("audio/"))
            self.assertEqual(preview_resp.content, b"RIFFdemo")

            missing_resp = self.client.get(
                f"/api/v1/tts/projects/{project_id}/postprocess/assets/preview?type=ambience"
            )
            self.assertEqual(missing_resp.status_code, 404)

            bad_type_resp = self.client.get(
                f"/api/v1/tts/projects/{project_id}/postprocess/assets/preview?type=bad"
            )
            self.assertEqual(bad_type_resp.status_code, 400)
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")

    def test_asr_transcribe_file_endpoint_shape(self) -> None:
        asr = self.app_state.asr_engine
        original_transcribe = asr.transcribe

        async def fake_transcribe(audio_path: str, *, backend: str = "whisper", speaker_labels: bool = False):
            self.assertTrue(Path(audio_path).exists())
            return {
                "text": "测试文本",
                "labeled_text": "说话人1：测试文本",
                "backend": backend,
                "speaker_labels": speaker_labels,
                "model_files": {
                    "main_model_path": "",
                },
                "alignments": [],
                "warnings": [],
            }

        asr.transcribe = fake_transcribe
        try:
            response = self.client.post(
                "/api/v1/asr/transcribe-file",
                data={"backend": "whisper", "speaker_labels": "true"},
                files={"file": ("sample.wav", b"RIFFdemo", "audio/wav")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["text"], "测试文本")
            self.assertEqual(body["labeled_text"], "说话人1：测试文本")
            self.assertEqual(body["backend"], "whisper")
            self.assertTrue(body["speaker_labels"])
        finally:
            asr.transcribe = original_transcribe

    def test_asr_transcribe_file_rejects_qwen_backend(self) -> None:
        response = self.client.post(
            "/api/v1/asr/transcribe-file",
            data={"backend": "qwen3_asr", "speaker_labels": "false"},
            files={"file": ("sample.wav", b"RIFFdemo", "audio/wav")},
        )
        self.assertEqual(response.status_code, 400)

    def test_asr_project_from_audio_endpoint_shape(self) -> None:
        original_runner = asr_routes._run_project_from_audio_task

        async def fake_runner(task_id, task_input, state):
            task = state.asr_tasks[task_id]
            task["status"] = "done"
            task["result"] = {
                "project_id": "project-1",
                "status": "parse_queued",
                "text": "你好",
                "labeled_text": "旁白：你好",
                "segments": [{"id": "s1", "start_ms": 0, "end_ms": 1000, "text": "你好", "speaker": "旁白"}],
                "speaker_map": {"旁白": "旁白"},
                "warnings": [],
                "failed_chunks": [],
                "parse_task_id": "parse-1",
                "chunk_progress": {"completed": 1, "total": 1},
            }
            task["events"].append({"type": "complete", "data": task["result"]})

        asr_routes._run_project_from_audio_task = fake_runner
        try:
            response = self.client.post(
                "/api/v1/asr/project-from-audio",
                data={
                    "project_name": "音频项目",
                    "speaker_labels": "true",
                    "parse_mode": "verified_five_step_pipeline",
                    "auto_parse": "true",
                    "speaker_map": "{\"说话人1\":\"旁白\"}",
                },
                files={"file": ("sample.wav", b"RIFFdemo", "audio/wav")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertTrue(body.get("task_id"))
            task_id = body["task_id"]
            task_state = self.client.get(f"/api/v1/asr/project-from-audio/{task_id}")
            self.assertEqual(task_state.status_code, 200)
            task_body = task_state.json()
            self.assertEqual(task_body["status"], "done")
            result = task_body["result"]
            self.assertEqual(result["project_id"], "project-1")
            self.assertEqual(result["status"], "parse_queued")
            self.assertEqual(result["parse_task_id"], "parse-1")
            self.assertEqual(result["speaker_map"], {"旁白": "旁白"})
        finally:
            asr_routes._run_project_from_audio_task = original_runner

    def test_translation_engine_status_endpoint_shape(self) -> None:
        response = self.client.get("/api/v1/llm/translation-engine/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("loaded", body)
        self.assertIn("source", body)
        self.assertIn("backend", body)
        self.assertIn("model_name", body)
        self.assertIn("error", body)

    def test_translation_engine_load_translate_unload_flow(self) -> None:
        state = self.app_state
        engine = state.translation_llm_engine
        original_load_model = engine.load_model
        original_unload_model = engine.unload_model
        original_generate_text = engine.generate_text
        original_source = state.translation_engine_source
        original_error = state.translation_engine_error
        original_is_loaded = engine.is_loaded
        original_backend_name = engine.backend_name
        original_model_name = engine.model_name
        try:
            async def fake_load_model(*args, **kwargs):
                engine.is_loaded = True
                engine.backend_name = "mock"
                engine.model_name = "translation-mock"
                engine.last_error = ""

            async def fake_unload_model():
                engine.is_loaded = False
                engine.backend_name = "unloaded"
                engine.model_name = ""

            async def fake_generate_text(*, text: str, system_prompt: str, llm_options: dict | None = None):
                self.assertTrue(text)
                self.assertTrue(system_prompt)
                return "翻译润色后的文本"

            engine.load_model = fake_load_model
            engine.unload_model = fake_unload_model
            engine.generate_text = fake_generate_text

            load_resp = self.client.post("/api/v1/llm/translation-engine/load", json={"source": "secondary_local"})
            self.assertEqual(load_resp.status_code, 200)
            self.assertEqual(load_resp.json()["source"], "secondary_local")

            trans_resp = self.client.post(
                "/api/v1/llm/translate-polish",
                json={
                    "text": "hello world",
                    "mode": "translate_polish",
                    "target_language": "中文",
                    "source": "secondary_local",
                },
            )
            self.assertEqual(trans_resp.status_code, 200)
            body = trans_resp.json()
            self.assertEqual(body["text"], "翻译润色后的文本")
            self.assertEqual(body["source"], "secondary_local")

            mismatch_resp = self.client.post(
                "/api/v1/llm/translate-polish",
                json={
                    "text": "hello world",
                    "mode": "polish_only",
                    "target_language": "中文",
                    "source": "primary_local",
                },
            )
            self.assertEqual(mismatch_resp.status_code, 400)

            unload_resp = self.client.post("/api/v1/llm/translation-engine/unload")
            self.assertEqual(unload_resp.status_code, 200)
        finally:
            engine.load_model = original_load_model
            engine.unload_model = original_unload_model
            engine.generate_text = original_generate_text
            state.translation_engine_source = original_source
            state.translation_engine_error = original_error
            engine.is_loaded = original_is_loaded
            engine.backend_name = original_backend_name
            engine.model_name = original_model_name

    def test_music_assist_load_chat_finalize_unload_flow(self) -> None:
        state = self.app_state
        engine = state.music_assist_llm_engine
        original_load_model = engine.load_model
        original_unload_model = engine.unload_model
        original_generate_text = engine.generate_text
        original_source = state.music_assist_engine_source
        original_error = state.music_assist_engine_error
        original_is_loaded = engine.is_loaded
        original_backend_name = engine.backend_name
        original_model_name = engine.model_name
        try:
            async def fake_load_model(*args, **kwargs):
                engine.is_loaded = True
                engine.backend_name = "mock"
                engine.model_name = "music-assist-mock"
                engine.last_error = ""

            async def fake_unload_model():
                engine.is_loaded = False
                engine.backend_name = "unloaded"
                engine.model_name = ""

            async def fake_generate_text(*, text: str, system_prompt: str, llm_options: dict | None = None):
                self.assertTrue(text)
                if "只输出一个 JSON 对象" in system_prompt:
                    return json.dumps(
                        {
                            "prompt": "warm cinematic piano, soft strings, hopeful ending",
                            "lyrics": "[Instrumental]",
                            "audio_duration": 30,
                            "vocal_language": "unknown",
                            "bpm": 120,
                            "keyscale": "C major",
                            "timesignature": "4/4",
                            "notes": "节奏平稳，适合旁白",
                            "warnings": [],
                        },
                        ensure_ascii=False,
                    )
                return "可以先确定情绪和配器，再决定歌词是否留空。"

            engine.load_model = fake_load_model
            engine.unload_model = fake_unload_model
            engine.generate_text = fake_generate_text

            load_resp = self.client.post("/api/v1/music/assist/load", json={"source": "secondary_local"})
            self.assertEqual(load_resp.status_code, 200)
            self.assertEqual(load_resp.json().get("source"), "secondary_local")

            status_resp = self.client.get("/api/v1/music/assist/status")
            self.assertEqual(status_resp.status_code, 200)
            self.assertTrue(status_resp.json().get("loaded"))

            chat_resp = self.client.post(
                "/api/v1/music/assist/chat",
                json={
                    "source": "secondary_local",
                    "messages": [
                        {"role": "assistant", "content": "你想做什么风格？"},
                        {"role": "user", "content": "电影感钢琴配乐，30秒"},
                    ],
                    "audio_duration": 30,
                    "vocal_language": "unknown",
                },
            )
            self.assertEqual(chat_resp.status_code, 200)
            self.assertTrue(chat_resp.json().get("reply"))

            finalize_resp = self.client.post(
                "/api/v1/music/assist/finalize",
                json={
                    "source": "secondary_local",
                    "messages": [
                        {"role": "assistant", "content": "你想做什么风格？"},
                        {"role": "user", "content": "电影感钢琴配乐，30秒"},
                    ],
                    "audio_duration": 30,
                    "vocal_language": "unknown",
                },
            )
            self.assertEqual(finalize_resp.status_code, 200)
            body = finalize_resp.json()
            self.assertEqual(body.get("prompt"), "warm cinematic piano, soft strings, hopeful ending")
            self.assertEqual(body.get("lyrics"), "[Instrumental]")
            self.assertEqual(body.get("bpm"), 120)
            self.assertEqual(body.get("keyscale"), "C major")
            self.assertEqual(body.get("timesignature"), "4/4")

            unload_resp = self.client.post("/api/v1/music/assist/unload", json={})
            self.assertEqual(unload_resp.status_code, 200)
        finally:
            engine.load_model = original_load_model
            engine.unload_model = original_unload_model
            engine.generate_text = original_generate_text
            state.music_assist_engine_source = original_source
            state.music_assist_engine_error = original_error
            engine.is_loaded = original_is_loaded
            engine.backend_name = original_backend_name
            engine.model_name = original_model_name

    def test_music_generate_cancel_and_conflict_flow(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_music_model_dir = state.orchestrator.config.music_model_dir
        original_ensure_music_ready = state.orchestrator.ensure_music_ready
        original_generate_to_file = state.music_engine.generate_to_file

        state.music_tasks.clear()
        state.music_task_handles.clear()

        release_event = threading.Event()
        try:
            state.orchestrator.config.music_enabled = True
            state.orchestrator.config.music_model_dir = str(state.settings.output_dir)

            async def fake_ensure_music_ready():
                return None

            async def fake_generate_to_file(**kwargs):
                await asyncio.to_thread(release_event.wait, 2.0)
                return {
                    "sample_rate": 48000,
                    "channels": 2,
                    "frames": 48000,
                    "duration_seconds": 1.0,
                    "seed": 0,
                    "output_path": str(kwargs["output_path"]),
                }

            state.orchestrator.ensure_music_ready = fake_ensure_music_ready
            state.music_engine.generate_to_file = fake_generate_to_file

            first_resp = self.client.post(
                "/api/v1/music/generate",
                json={
                    "prompt": "cinematic piano underscore",
                    "audio_duration": 12,
                    "vocal_language": "unknown",
                    "num_inference_steps": 8,
                },
            )
            self.assertEqual(first_resp.status_code, 200)
            task_id = first_resp.json()["task_id"]

            running_seen = False
            for _ in range(30):
                task_resp = self.client.get(f"/api/v1/music/tasks/{task_id}")
                self.assertEqual(task_resp.status_code, 200)
                status = task_resp.json().get("status")
                if status == "running":
                    running_seen = True
                    break
                time.sleep(0.05)
            self.assertTrue(running_seen)

            conflict_resp = self.client.post(
                "/api/v1/music/generate",
                json={
                    "prompt": "another music request",
                    "audio_duration": 8,
                    "vocal_language": "unknown",
                    "num_inference_steps": 8,
                },
            )
            self.assertEqual(conflict_resp.status_code, 409)

            cancel_resp = self.client.post(f"/api/v1/music/tasks/{task_id}/cancel", json={})
            self.assertEqual(cancel_resp.status_code, 200)
            self.assertEqual(cancel_resp.json().get("status"), "cancel_requested")

            release_event.set()

            canceled_seen = False
            for _ in range(40):
                task_resp = self.client.get(f"/api/v1/music/tasks/{task_id}")
                self.assertEqual(task_resp.status_code, 200)
                task_payload = task_resp.json()
                status = task_payload.get("status")
                if status == "canceled":
                    self.assertTrue(task_payload.get("cancel_message"))
                    canceled_seen = True
                    break
                time.sleep(0.05)
            self.assertTrue(canceled_seen)
        finally:
            release_event.set()
            state.orchestrator.config.music_enabled = original_music_enabled
            state.orchestrator.config.music_model_dir = original_music_model_dir
            state.orchestrator.ensure_music_ready = original_ensure_music_ready
            state.music_engine.generate_to_file = original_generate_to_file

    def test_music_generate_task_type_parameter_mapping(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_music_model_dir = state.orchestrator.config.music_model_dir
        original_music_model_variant = state.orchestrator.config.music_model_variant
        original_ensure_music_ready = state.orchestrator.ensure_music_ready
        original_generate_to_file = state.music_engine.generate_to_file

        state.music_tasks.clear()
        state.music_task_handles.clear()

        source_name = f"mode_src_{uuid.uuid4().hex[:8]}.wav"
        reference_name = f"mode_ref_{uuid.uuid4().hex[:8]}.wav"
        source_path = state.settings.output_dir / "music" / source_name
        reference_path = state.settings.output_dir / "music" / reference_name
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(b"RIFFsrc")
        reference_path.write_bytes(b"RIFFref")

        captured_kwargs: list[dict] = []
        try:
            state.orchestrator.config.music_enabled = True
            state.orchestrator.config.music_model_dir = str(state.settings.output_dir)
            state.orchestrator.config.music_model_variant = "base"

            async def fake_ensure_music_ready():
                return None

            async def fake_generate_to_file(**kwargs):
                captured_kwargs.append(dict(kwargs))
                return {
                    "sample_rate": 48000,
                    "channels": 2,
                    "frames": 48000,
                    "duration_seconds": 1.0,
                    "seed": int(kwargs.get("seed") or 0),
                    "output_path": str(kwargs["output_path"]),
                }

            state.orchestrator.ensure_music_ready = fake_ensure_music_ready
            state.music_engine.generate_to_file = fake_generate_to_file

            mode_cases = [
                {
                    "task_type": "text2music",
                    "payload": {"prompt": "text2music prompt"},
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "text2music"),
                        self.assertIsNone(kw.get("source_audio_path")),
                        self.assertIsNone(kw.get("reference_audio_path")),
                    ),
                },
                {
                    "task_type": "cover",
                    "payload": {
                        "prompt": "cover prompt",
                        "source_asset_name": source_name,
                        "reference_asset_name": reference_name,
                        "audio_cover_strength": 0.4,
                    },
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "cover"),
                        self.assertEqual(Path(str(kw.get("source_audio_path"))).name, source_name),
                        self.assertEqual(Path(str(kw.get("reference_audio_path"))).name, reference_name),
                        self.assertAlmostEqual(float(kw.get("audio_cover_strength")), 0.4, places=4),
                    ),
                },
                {
                    "task_type": "repaint",
                    "payload": {
                        "prompt": "repaint prompt",
                        "source_asset_name": source_name,
                        "repainting_start": 2.0,
                        "repainting_end": 8.5,
                    },
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "repaint"),
                        self.assertEqual(Path(str(kw.get("source_audio_path"))).name, source_name),
                        self.assertAlmostEqual(float(kw.get("repainting_start")), 2.0, places=4),
                        self.assertAlmostEqual(float(kw.get("repainting_end")), 8.5, places=4),
                    ),
                },
                {
                    "task_type": "lego",
                    "payload": {
                        "prompt": "lego prompt",
                        "source_asset_name": source_name,
                        "track_name": "drums",
                        "repainting_start": 1.5,
                        "repainting_end": 6.0,
                    },
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "lego"),
                        self.assertEqual(Path(str(kw.get("source_audio_path"))).name, source_name),
                        self.assertEqual(kw.get("track_name"), "drums"),
                        self.assertAlmostEqual(float(kw.get("repainting_start")), 1.5, places=4),
                        self.assertAlmostEqual(float(kw.get("repainting_end")), 6.0, places=4),
                    ),
                },
                {
                    "task_type": "extract",
                    "payload": {
                        "prompt": "extract prompt",
                        "source_asset_name": source_name,
                        "track_name": "vocals",
                    },
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "extract"),
                        self.assertEqual(Path(str(kw.get("source_audio_path"))).name, source_name),
                        self.assertEqual(kw.get("track_name"), "vocals"),
                    ),
                },
                {
                    "task_type": "complete",
                    "payload": {
                        "prompt": "complete prompt",
                        "source_asset_name": source_name,
                        "complete_track_classes": ["vocals", "drums"],
                    },
                    "assertions": lambda kw: (
                        self.assertEqual(kw.get("task_type"), "complete"),
                        self.assertEqual(Path(str(kw.get("source_audio_path"))).name, source_name),
                        self.assertEqual(kw.get("complete_track_classes"), ["vocals", "drums"]),
                    ),
                },
            ]

            for case in mode_cases:
                with self.subTest(task_type=case["task_type"]):
                    request_payload = {
                        "task_type": case["task_type"],
                        "audio_duration": 12,
                        "vocal_language": "unknown",
                        "num_inference_steps": 50,
                        "seed": 123,
                        "guidance_scale": 6.5,
                        "shift": 2.8,
                        **case["payload"],
                    }
                    before = len(captured_kwargs)
                    create_resp = self.client.post("/api/v1/music/generate", json=request_payload)
                    self.assertEqual(create_resp.status_code, 200)
                    task_id = create_resp.json()["task_id"]

                    done = False
                    for _ in range(50):
                        status_resp = self.client.get(f"/api/v1/music/tasks/{task_id}")
                        self.assertEqual(status_resp.status_code, 200)
                        status_payload = status_resp.json()
                        if status_payload.get("status") == "done":
                            done = True
                            break
                        time.sleep(0.03)
                    self.assertTrue(done)

                    self.assertGreater(len(captured_kwargs), before)
                    kwargs = captured_kwargs[-1]
                    self.assertEqual(kwargs.get("seed"), 123)
                    self.assertAlmostEqual(float(kwargs.get("guidance_scale")), 6.5, places=4)
                    self.assertAlmostEqual(float(kwargs.get("shift")), 2.8, places=4)
                    case["assertions"](kwargs)
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled
            state.orchestrator.config.music_model_dir = original_music_model_dir
            state.orchestrator.config.music_model_variant = original_music_model_variant
            state.orchestrator.ensure_music_ready = original_ensure_music_ready
            state.music_engine.generate_to_file = original_generate_to_file
            source_path.unlink(missing_ok=True)
            reference_path.unlink(missing_ok=True)

    def test_music_generate_base_requires_32_to_100_inference_steps(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_music_model_variant = state.orchestrator.config.music_model_variant
        try:
            state.orchestrator.config.music_enabled = True
            state.orchestrator.config.music_model_variant = "base"
            response = self.client.post(
                "/api/v1/music/generate",
                json={
                    "task_type": "text2music",
                    "prompt": "base step check",
                    "audio_duration": 10,
                    "vocal_language": "unknown",
                    "num_inference_steps": 8,
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("32 - 100", str(response.json().get("message") or response.json().get("detail") or ""))
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled
            state.orchestrator.config.music_model_variant = original_music_model_variant

    def test_music_generate_turbo_forces_zero_guidance_scale(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_music_model_dir = state.orchestrator.config.music_model_dir
        original_music_model_variant = state.orchestrator.config.music_model_variant
        original_ensure_music_ready = state.orchestrator.ensure_music_ready
        original_generate_to_file = state.music_engine.generate_to_file
        captured_kwargs: list[dict] = []

        try:
            state.orchestrator.config.music_enabled = True
            state.orchestrator.config.music_model_dir = str(state.settings.output_dir)
            state.orchestrator.config.music_model_variant = "turbo"

            async def fake_ensure_music_ready():
                return None

            async def fake_generate_to_file(**kwargs):
                captured_kwargs.append(dict(kwargs))
                return {
                    "sample_rate": 48000,
                    "channels": 2,
                    "frames": 48000,
                    "duration_seconds": 1.0,
                    "seed": int(kwargs.get("seed") or 0),
                    "output_path": str(kwargs["output_path"]),
                }

            state.orchestrator.ensure_music_ready = fake_ensure_music_ready
            state.music_engine.generate_to_file = fake_generate_to_file

            create_resp = self.client.post(
                "/api/v1/music/generate",
                json={
                    "task_type": "text2music",
                    "prompt": "turbo cfg check",
                    "audio_duration": 10,
                    "vocal_language": "unknown",
                    "num_inference_steps": 8,
                    "guidance_scale": 9.5,
                },
            )
            self.assertEqual(create_resp.status_code, 200)
            task_id = create_resp.json()["task_id"]

            done = False
            for _ in range(50):
                status_resp = self.client.get(f"/api/v1/music/tasks/{task_id}")
                self.assertEqual(status_resp.status_code, 200)
                if status_resp.json().get("status") == "done":
                    done = True
                    break
                time.sleep(0.03)
            self.assertTrue(done)
            self.assertGreater(len(captured_kwargs), 0)
            self.assertAlmostEqual(float(captured_kwargs[-1].get("guidance_scale")), 0.0, places=6)
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled
            state.orchestrator.config.music_model_dir = original_music_model_dir
            state.orchestrator.config.music_model_variant = original_music_model_variant
            state.orchestrator.ensure_music_ready = original_ensure_music_ready
            state.music_engine.generate_to_file = original_generate_to_file

    def test_music_generate_turbo_rejects_unsupported_shift(self) -> None:
        state = self.app_state
        original_music_enabled = state.orchestrator.config.music_enabled
        original_music_model_variant = state.orchestrator.config.music_model_variant
        try:
            state.orchestrator.config.music_enabled = True
            state.orchestrator.config.music_model_variant = "turbo"
            for shift in (2.8, 4.0):
                with self.subTest(shift=shift):
                    response = self.client.post(
                        "/api/v1/music/generate",
                        json={
                            "task_type": "text2music",
                            "prompt": "turbo shift check",
                            "audio_duration": 10,
                            "vocal_language": "unknown",
                            "num_inference_steps": 8,
                            "shift": shift,
                        },
                    )
                    self.assertEqual(response.status_code, 400)
                    self.assertIn("shift", str(response.json().get("message") or response.json().get("detail") or ""))
        finally:
            state.orchestrator.config.music_enabled = original_music_enabled
            state.orchestrator.config.music_model_variant = original_music_model_variant

    def test_unload_asr_endpoint_clears_asr_runtime_state(self) -> None:
        asr = self.app_state.asr_engine
        original_is_loaded = asr.is_loaded
        original_backend_name = asr.backend_name
        original_last_error = asr.last_error
        original_backend = getattr(asr, "_backend", None)
        original_model = getattr(asr, "_model", None)
        asr.is_loaded = True
        asr.backend_name = "faster-whisper"
        asr.last_error = "previous error"
        asr._backend = "faster-whisper"
        asr._model = object()

        try:
            response = self.client.post("/api/v1/system/unload-asr")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(asr.is_loaded)
            self.assertEqual(asr.backend_name, "unloaded")
            self.assertEqual(asr.last_error, "")
            self.assertIsNone(asr._backend)
            self.assertIsNone(asr._model)
        finally:
            asr.is_loaded = original_is_loaded
            asr.backend_name = original_backend_name
            asr.last_error = original_last_error
            asr._backend = original_backend
            asr._model = original_model

    def test_default_prompt(self) -> None:
        response = self.client.get("/api/v1/llm/prompts/default")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("prompt"))

    def test_parse_stats_not_found(self) -> None:
        response = self.client.get(f"/api/v1/llm/parse/{uuid.uuid4()}/stats")
        self.assertEqual(response.status_code, 404)

    def test_parse_stats_response_shape(self) -> None:
        task_id = f"stats-{uuid.uuid4()}"
        self.app_state.llm_tasks[task_id] = {
            "task_id": task_id,
            "status": "done",
            "parse_mode": "two_step_pipeline",
            "stage": "done",
            "stage_label": "解析完成",
            "stage_progress": 100,
            "result": {"segments": []},
            "error": "",
            "project_id": None,
            "events": [],
            "step_stats": {"step1_structure": {}, "step2_tts": {}},
            "parse_stats": {
                "mode": "two_step",
                "parse_mode": "two_step_pipeline",
                "duration_ms": 123,
                "total_chunks": 1,
                "step_stats": {"step1_structure": {}, "step2_tts": {}},
            },
        }
        try:
            response = self.client.get(f"/api/v1/llm/parse/{task_id}/stats")
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["task_id"], task_id)
            self.assertEqual(body["status"], "done")
            self.assertEqual(body["parse_stats"]["mode"], "two_step")
            self.assertEqual(body["parse_mode"], "two_step_pipeline")
            self.assertEqual(body["stage"], "done")
            self.assertEqual(body["stage_progress"], 100)
            self.assertEqual(body["parse_stats"]["duration_ms"], 123)
            # observability fields should be preserved for frontend diagnostics
            self.assertIn("total_chunks", body["parse_stats"])
            self.assertIn("step_stats", body)
        finally:
            self.app_state.llm_tasks.pop(task_id, None)

    def test_parse_pending_shape_contains_stage_fields(self) -> None:
        task_id = f"pending-{uuid.uuid4()}"
        self.app_state.llm_tasks[task_id] = {
            "task_id": task_id,
            "status": "running",
            "parse_mode": "two_step_pipeline",
            "stage": "step1_structure",
            "stage_label": "Step 1：解析文本结构与角色",
            "stage_progress": 33,
            "result": None,
            "error": "",
            "project_id": None,
            "events": [],
            "step_stats": {},
        }
        try:
            response = self.client.get(f"/api/v1/llm/parse/{task_id}")
            self.assertEqual(response.status_code, 202)
            body = response.json()
            self.assertEqual(body["parse_mode"], "two_step_pipeline")
            self.assertEqual(body["stage"], "step1_structure")
            self.assertEqual(body["stage_progress"], 33)
        finally:
            self.app_state.llm_tasks.pop(task_id, None)

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
            "llm_clip_model_path": "E:/models/mmproj/qwen35.mmproj",
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
            self.assertEqual(body["llm_clip_model_path"], "E:/models/mmproj/qwen35.mmproj")
            self.assertEqual(body["llm_threads"], 8)
            self.assertEqual(body["asr_model_path"], "E:/models/faster-whisper-large-v3")
            self.assertAlmostEqual(body["llm_temperature"], 0.35, places=6)
            persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
            self.assertFalse(persisted["enable_llama_cpp_think_mode"])
            self.assertEqual(persisted["llm_backend"], "openai")
            self.assertEqual(persisted["llm_clip_model_path"], "E:/models/mmproj/qwen35.mmproj")
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

    def test_set_current_config_as_default_and_reset(self) -> None:
        cfg_path = self.app_state.settings.runtime_config_path
        defaults_path = self.app_state.settings.runtime_defaults_config_path
        original_cfg = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else None
        original_defaults = defaults_path.read_text(encoding="utf-8") if defaults_path.exists() else None
        payload_a = {
            "auto_serial": True,
            "auto_unload_llm_after_parse": True,
            "auto_load_tts_before_synth": True,
            "debug_stale_report": False,
            "enable_llama_cpp_think_mode": False,
            "llm_backend": "llama_cpp",
            "llm_model_path": "E:/models/default-a.gguf",
            "llm_clip_model_path": "E:/models/default-a.mmproj",
            "llm_api_model": "gpt-4.1-mini",
            "llm_n_ctx": 6144,
            "llm_n_gpu_layers": -1,
            "llm_threads": 6,
            "llm_temperature": 0.33,
            "llm_top_p": 0.91,
            "llm_top_k": 37,
            "llm_min_p": 0.03,
            "llm_presence_penalty": 0.1,
            "llm_repeat_penalty": 1.07,
            "llm_max_tokens": 1900,
            "tts_model_path": "E:/models/omnivoice-a",
            "tts_device": "cuda:0",
            "asr_model_path": "base",
            "asr_device": "cuda:0",
        }
        payload_b = {**payload_a, "llm_model_path": "E:/models/changed-b.gguf", "llm_n_ctx": 8192}
        try:
            self.assertEqual(self.client.put("/api/v1/system/orchestrator/config", json=payload_a).status_code, 200)
            set_default_resp = self.client.post("/api/v1/system/orchestrator/config/defaults/use-current", json={})
            self.assertEqual(set_default_resp.status_code, 200)

            self.assertEqual(self.client.put("/api/v1/system/orchestrator/config", json=payload_b).status_code, 200)
            reset_resp = self.client.post("/api/v1/system/orchestrator/config/reset", json={})
            self.assertEqual(reset_resp.status_code, 200)
            body = reset_resp.json()
            self.assertEqual(body["llm_model_path"], payload_a["llm_model_path"])
            self.assertEqual(body["llm_n_ctx"], payload_a["llm_n_ctx"])
            self.assertFalse(body["enable_llama_cpp_think_mode"])

            persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["llm_model_path"], payload_a["llm_model_path"])
            self.assertEqual(persisted["llm_n_ctx"], payload_a["llm_n_ctx"])
        finally:
            if original_cfg is None:
                cfg_path.unlink(missing_ok=True)
            else:
                cfg_path.write_text(original_cfg, encoding="utf-8")
            if original_defaults is None:
                defaults_path.unlink(missing_ok=True)
            else:
                defaults_path.write_text(original_defaults, encoding="utf-8")

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
            "llm_clip_model_path": "E:/models/mmproj/keep.mmproj",
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
            self.assertEqual(cfg.get("llm_clip_model_path"), "E:/models/mmproj/keep.mmproj")
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

    def test_deduplicate_project_files_dry_run_and_execute(self) -> None:
        projects_dir = self.app_state.settings.projects_dir
        dup_name = f"dup-{uuid.uuid4().hex[:6]}"
        dup_old = Project(
            name=dup_name,
            project_origin=ProjectOrigin(
                kind="project_file",
                source_project_id="src-dup",
                project_file_name="dup.bvtproject.json",
                project_file_fingerprint="fingerprint-dup-001",
            ),
        )
        dup_new = Project(
            name=dup_name,
            project_origin=ProjectOrigin(
                kind="project_file",
                source_project_id="src-dup",
                project_file_name="dup.bvtproject.json",
                project_file_fingerprint="fingerprint-dup-001",
            ),
        )
        unique = Project(
            name=f"unique-{uuid.uuid4().hex[:6]}",
            project_origin=ProjectOrigin(
                kind="project_file",
                source_project_id="src-unique",
                project_file_name="unique.bvtproject.json",
                project_file_fingerprint="fingerprint-unique-001",
            ),
        )

        save_project(projects_dir, dup_old)
        save_project(projects_dir, dup_new)
        save_project(projects_dir, unique)

        try:
            dry_run = self.client.post(
                "/api/v1/projects/maintenance/deduplicate-project-files",
                json={"dry_run": True},
            )
            self.assertEqual(dry_run.status_code, 200)
            dry_body = dry_run.json()
            self.assertTrue(dry_body["dry_run"])
            self.assertEqual(dry_body["group_count"], 1)
            self.assertEqual(dry_body["remove_count"], 1)
            self.assertEqual(len(dry_body["groups"]), 1)
            self.assertEqual(dry_body["groups"][0]["keep_project_id"], dup_new.id)
            self.assertEqual(dry_body["groups"][0]["remove_project_ids"], [dup_old.id])

            # Dry-run should not remove any file.
            self.assertEqual(load_project(projects_dir, dup_old.id).id, dup_old.id)
            self.assertEqual(load_project(projects_dir, dup_new.id).id, dup_new.id)

            execute = self.client.post(
                "/api/v1/projects/maintenance/deduplicate-project-files",
                json={"dry_run": False},
            )
            self.assertEqual(execute.status_code, 200)
            exec_body = execute.json()
            self.assertFalse(exec_body["dry_run"])
            self.assertEqual(exec_body["group_count"], 1)
            self.assertEqual(exec_body["remove_count"], 1)

            listed = self.client.get("/api/v1/projects")
            self.assertEqual(listed.status_code, 200)
            ids = {item["id"] for item in listed.json()}
            self.assertNotIn(dup_old.id, ids)
            self.assertIn(dup_new.id, ids)
            self.assertIn(unique.id, ids)
        finally:
            for project_id in (dup_old.id, dup_new.id, unique.id):
                self.client.delete(f"/api/v1/projects/{project_id}")

    def test_merge_project_file_shadows_dry_run_and_execute(self) -> None:
        projects_dir = self.app_state.settings.projects_dir
        source = Project(name=f"shadow-{uuid.uuid4().hex[:6]}")
        save_project(projects_dir, source)
        shadow = Project(
            name=source.name,
            project_origin=ProjectOrigin(
                kind="project_file",
                source_project_id=source.id,
                project_file_name="shadow.bvtproject.json",
                project_file_fingerprint="shadow-fingerprint-001",
            ),
        )
        save_project(projects_dir, shadow)

        try:
            dry_run = self.client.post(
                "/api/v1/projects/maintenance/merge-project-file-shadows",
                json={"dry_run": True},
            )
            self.assertEqual(dry_run.status_code, 200)
            dry_body = dry_run.json()
            self.assertTrue(dry_body["dry_run"])
            self.assertEqual(dry_body["pair_count"], 1)
            self.assertEqual(dry_body["remove_count"], 1)
            self.assertEqual(dry_body["updated_source_count"], 0)
            self.assertEqual(dry_body["pairs"][0]["source_project_id"], source.id)
            self.assertEqual(dry_body["pairs"][0]["shadow_project_id"], shadow.id)

            # Dry-run should keep both projects.
            self.assertEqual(load_project(projects_dir, source.id).id, source.id)
            self.assertEqual(load_project(projects_dir, shadow.id).id, shadow.id)

            execute = self.client.post(
                "/api/v1/projects/maintenance/merge-project-file-shadows",
                json={"dry_run": False},
            )
            self.assertEqual(execute.status_code, 200)
            exec_body = execute.json()
            self.assertFalse(exec_body["dry_run"])
            self.assertEqual(exec_body["pair_count"], 1)
            self.assertEqual(exec_body["remove_count"], 1)
            self.assertEqual(exec_body["updated_source_count"], 1)

            source_after = load_project(projects_dir, source.id)
            self.assertEqual(source_after.project_origin.kind, "project_file")
            self.assertEqual(source_after.project_origin.source_project_id, source.id)
            self.assertEqual(source_after.project_origin.project_file_name, "shadow.bvtproject.json")
            self.assertEqual(source_after.project_origin.project_file_fingerprint, "shadow-fingerprint-001")

            listed = self.client.get("/api/v1/projects")
            self.assertEqual(listed.status_code, 200)
            ids = {item["id"] for item in listed.json()}
            self.assertIn(source.id, ids)
            self.assertNotIn(shadow.id, ids)
        finally:
            self.client.delete(f"/api/v1/projects/{shadow.id}")
            self.client.delete(f"/api/v1/projects/{source.id}")

    def test_project_list_contains_origin_kind(self) -> None:
        name = f"origin-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]
        try:
            listed = self.client.get("/api/v1/projects")
            self.assertEqual(listed.status_code, 200)
            by_id = {item["id"]: item for item in listed.json()}
            self.assertIn(project_id, by_id)
            self.assertEqual(by_id[project_id]["origin_kind"], "local")
            self.assertIn("source_project_id", by_id[project_id])
            self.assertIn("project_file_name", by_id[project_id])
        finally:
            self.client.delete(f"/api/v1/projects/{project_id}")

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
        reused_id = None
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
            self.assertEqual(imported_id, source_id)
            self.assertEqual(import_body["project_name"], created.json()["name"])
            self.assertEqual(import_body["import_source"], "project_file")
            self.assertEqual(import_body["open_mode"], "reused")
            self.assertEqual(import_body["match_reason"], "source_project_id")
            self.assertTrue(import_body["project_file_fingerprint"])

            imported_project = self.client.get(f"/api/v1/projects/{imported_id}")
            self.assertEqual(imported_project.status_code, 200)
            body = imported_project.json()
            self.assertEqual(body["name"], created.json()["name"])
            self.assertEqual(body["script"]["source_text"], "旁白：这是轻量项目文件测试文本。")
            self.assertEqual(len(body["script"]["segments"]), 1)
            self.assertEqual(body["voice_assignments"].get("narrator"), "preset-001")
            self.assertEqual(body["project_origin"]["kind"], "project_file")
            self.assertEqual(body["project_origin"]["source_project_id"], source_id)
            self.assertEqual(body["project_origin"]["project_file_name"], "project.bvtproject.json")
            self.assertTrue(body["project_origin"]["project_file_fingerprint"])
            self.assertIsNone(body["audio_assets"]["full_wav_relpath"])
            self.assertIsNone(body["audio_assets"]["full_mp3_relpath"])
            self.assertEqual(body["audio_assets"]["segments"], {})

            second_file_bytes = io.BytesIO(json.dumps(exported, ensure_ascii=False).encode("utf-8"))
            second_import_resp = self.client.post(
                "/api/v1/projects/import/project-file",
                files={"file": ("project.bvtproject.json", second_file_bytes, "application/json")},
            )
            self.assertEqual(second_import_resp.status_code, 200)
            second_import_body = second_import_resp.json()
            reused_id = second_import_body["project_id"]
            self.assertEqual(reused_id, imported_id)
            self.assertEqual(second_import_body["open_mode"], "reused")
            self.assertEqual(second_import_body["match_reason"], "source_project_id")
        finally:
            if imported_id and imported_id != source_id:
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
