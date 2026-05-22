# AGENTS.md

## Environment

- Use the project virtual environment for Python work.
- On Windows, prefer `.\scripts\python.ps1 ...`; it dispatches to `.\.venv\Scripts\python.exe`.
- If calling Python directly, use `.\.venv\Scripts\python.exe`, not the system or conda `python`.
- If `.venv` is missing, create it with `python -m venv .venv` and install dependencies before running backend tests.

## Backend

- Run targeted backend tests through the virtual environment, for example:

```powershell
.\scripts\python.ps1 -m unittest backend.tests.test_asr_engine
.\scripts\python.ps1 -m unittest backend.tests.test_api_smoke.ApiSmokeTest.test_asr_transcribe_file_passes_preview_line_length_for_qwen_backends
```

- Prefer narrow tests for touched modules first, then broader suites when dependencies are available.
- Avoid using global Python package state as evidence for project test results.

## Frontend

- Run frontend commands from the repository root with `npm --prefix frontend ...`.
- Useful checks:

```powershell
npm --prefix frontend run build
npm --prefix frontend test
```

## Editing

- Keep changes scoped to the requested behavior.
- Do not revert unrelated working tree changes.
- Use existing project patterns before adding new abstractions.
