# Runtime Data Governance

## Scope

This document defines runtime data boundaries under `backend/data` and a safe cleanup policy.

## Directory Contract

- `backend/data/config.json`
  - Runtime configuration persisted from Settings page.
  - Source of truth at runtime.
  - Do not store API keys here.

- `backend/data/projects/*.json`
  - Project entity snapshots.
  - Core business data. Keep for long-term persistence.

- `backend/data/projects/*.events.jsonl`
  - Task event logs for replay and diagnostics.
  - Can grow over time and should be rotated/cleaned periodically.

- `backend/data/voices/`
  - Voice presets and uploaded reference audio.
  - Consider as user assets, keep unless user deletes.

- `backend/data/output/`
  - Exported audio and subtitles.
  - Includes task temp subfolders named by task id.
  - Safe to prune old task folders and stale exports.

- `backend/data/cache/tts/`
  - TTS segment cache artifacts.
  - Rebuildable data. Safe to delete when space is tight.

- `backend/data/tmp-tests/`
  - Temporary files created during tests.
  - Safe to delete after test runs.

## Retention Policy

- Keep forever:
  - `projects/*.json`
  - `voices/*`
  - `config.json`

- Keep with retention:
  - `projects/*.events.jsonl` keep 7-30 days
  - `output/` task folders keep 3-14 days
  - root exports (`*.wav/*.mp3/*.srt/*.lrc/*.archive.zip`) keep per project lifecycle

- Rebuildable:
  - `cache/tts/*`
  - `tmp-tests/*`

## Safe Cleanup Commands (PowerShell)

Run from repository root `E:\softs\BeautyVoiceTTS`.

Clean temporary test files:

```powershell
Get-ChildItem .\backend\data\tmp-tests -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
```

Clean TTS cache:

```powershell
Get-ChildItem .\backend\data\cache\tts -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
```

Prune output task folders older than 7 days:

```powershell
Get-ChildItem .\backend\data\output -Directory | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force
```

Prune event logs older than 30 days:

```powershell
Get-ChildItem .\backend\data\projects\*.events.jsonl | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
```

## Safety Rules

- Never mass-delete `projects/*.json` or `voices/*` in automation.
- Always scope cleanup to explicit subdirectories.
- Prefer age-based pruning for `output` and event logs.
- Keep `.env` out of any automated cleanup workflow.
