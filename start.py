from __future__ import annotations

import subprocess
import sys
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None


ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")

BACKEND_HOST = os.getenv("BV_BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = os.getenv("BV_BACKEND_PORT", "8050")


def run_backend() -> subprocess.Popen:
    python = str(VENV_PYTHON if VENV_PYTHON.exists() else sys.executable)
    return subprocess.Popen(
        [
            python,
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            BACKEND_HOST,
            "--port",
            BACKEND_PORT,
            "--reload",
        ],
        cwd=ROOT,
    )


def run_frontend() -> subprocess.Popen:
    env = os.environ.copy()
    env.setdefault("VITE_API_BASE_URL", f"http://{BACKEND_HOST}:{BACKEND_PORT}/api/v1")
    return subprocess.Popen(["npm", "run", "dev"], cwd=ROOT / "frontend", shell=True, env=env)


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
