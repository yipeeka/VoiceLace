from __future__ import annotations

import asyncio
import shutil
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace

from backend.mcp_server import build_mcp_server
from backend.state import create_app_state

TEST_OUTPUT_ROOT = Path(__file__).resolve().parents[2] / "tmp_test_outputs"


class McpServerTest(unittest.TestCase):
    def test_mcp_server_registers_core_tools(self) -> None:
        state = create_app_state()
        server = build_mcp_server(lambda: state)

        async def run() -> set[str]:
            tools = await server.list_tools()
            return {tool.name for tool in tools}

        tool_names = asyncio.run(run())
        self.assertIn("get_system_status", tool_names)
        self.assertIn("list_projects", tool_names)
        self.assertIn("start_parse_task", tool_names)
        self.assertIn("start_synthesis_task", tool_names)
        self.assertIn("start_music_task", tool_names)
        self.assertIn("cancel_task", tool_names)

    def test_qwen3_transcribe_audio_path_keeps_speaker_labels_and_forces_timestamps(self) -> None:
        root = TEST_OUTPUT_ROOT / f"mcp-qwen3-diar-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            output_dir = root / "output"
            data_dir = root / "data"
            voices_dir = root / "voices"
            for path in (output_dir, data_dir, voices_dir):
                path.mkdir(parents=True, exist_ok=True)
            audio = output_dir / "sample.wav"
            audio.write_bytes(b"RIFFdemo")
            calls: list[dict] = []

            class _FakeOrchestrator:
                config = SimpleNamespace(asr_backend="whisper")

                async def ensure_asr_ready(self, *, backend: str = "whisper") -> None:
                    calls.append({"ensure_backend": backend})

            class _FakeAsrEngine:
                qwen3_enable_timestamps = False
                last_error = ""

                async def transcribe(self, audio_path: str, **kwargs):
                    calls.append({"audio_path": audio_path, **kwargs})
                    return {"text": "你好", "alignments": [], "warnings": []}

            state = SimpleNamespace(
                settings=SimpleNamespace(
                    base_dir=root / "backend",
                    data_dir=data_dir,
                    output_dir=output_dir,
                    voices_dir=voices_dir,
                ),
                orchestrator=_FakeOrchestrator(),
                asr_engine=_FakeAsrEngine(),
            )
            server = build_mcp_server(lambda: state)

            async def run() -> None:
                await server.call_tool(
                    "transcribe_audio_path",
                    {
                        "audio_path": str(audio),
                        "backend": "qwen3_crispasr",
                        "speaker_labels": True,
                        "enable_timestamps": False,
                    },
                )

            asyncio.run(run())

            transcribe_call = next(item for item in calls if item.get("audio_path"))
            self.assertEqual(transcribe_call["backend"], "qwen3_crispasr")
            self.assertTrue(transcribe_call["speaker_labels"])
            self.assertTrue(transcribe_call["enable_timestamps"])
            self.assertFalse(transcribe_call["silence_aware_split"])
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
