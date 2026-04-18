from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services.tts_path_service import (
    project_full_dir,
    project_output_root,
    project_segment_waveforms_dir,
    project_segments_dir,
    project_subtitles_dir,
    project_waveforms_dir,
    to_output_relpath,
)


class TtsPathServiceTest(unittest.TestCase):
    def test_project_path_builders(self) -> None:
        output_dir = Path("E:/tmp/output")
        project_id = "pid-123"
        self.assertEqual(project_output_root(output_dir=output_dir, project_id=project_id), output_dir / "projects" / project_id)
        self.assertEqual(project_segments_dir(output_dir=output_dir, project_id=project_id), output_dir / "projects" / project_id / "segments")
        self.assertEqual(project_full_dir(output_dir=output_dir, project_id=project_id), output_dir / "projects" / project_id / "full")
        self.assertEqual(
            project_subtitles_dir(output_dir=output_dir, project_id=project_id),
            output_dir / "projects" / project_id / "subtitles",
        )
        self.assertEqual(project_waveforms_dir(output_dir=output_dir, project_id=project_id), output_dir / "projects" / project_id / "waveforms")
        self.assertEqual(
            project_segment_waveforms_dir(output_dir=output_dir, project_id=project_id),
            output_dir / "projects" / project_id / "waveforms" / "segments",
        )

    def test_to_output_relpath(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            path = output_dir / "projects" / "p1" / "segments" / "a.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"RIFF")
            rel = to_output_relpath(output_dir=output_dir, path=path)
            self.assertEqual(rel, "projects/p1/segments/a.wav")


if __name__ == "__main__":
    unittest.main()
