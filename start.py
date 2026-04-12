from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


def run_backend() -> subprocess.Popen:
    python = str(VENV_PYTHON if VENV_PYTHON.exists() else sys.executable)
    return subprocess.Popen([python, "-m", "uvicorn", "backend.main:app", "--reload"], cwd=ROOT)


def run_frontend() -> subprocess.Popen:
    return subprocess.Popen(["npm", "run", "dev"], cwd=ROOT / "frontend", shell=True)


def main() -> int:
    backend = run_backend()
    frontend = run_frontend()
    try:
        backend.wait()
        frontend.wait()
    except KeyboardInterrupt:
        backend.terminate()
        frontend.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
