param(
  [string]$ApiBase = "http://127.0.0.1:8000/api/v1",
  [string]$WebBase = "http://127.0.0.1:5173",
  [string]$ProjectId = "",
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

function Write-Step($text) {
  Write-Host ""
  Write-Host "== $text ==" -ForegroundColor Cyan
}

function Invoke-JsonGet([string]$url) {
  $resp = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 15
  if ($resp.StatusCode -lt 200 -or $resp.StatusCode -ge 300) {
    throw "HTTP $($resp.StatusCode): $url"
  }
  return ($resp.Content | ConvertFrom-Json)
}

function Try-JsonGet([string]$url) {
  try {
    return Invoke-JsonGet $url
  } catch {
    return $null
  }
}

Write-Step "1) Service health check"
$status = Invoke-JsonGet "$ApiBase/system/status"
Write-Host "API OK: $ApiBase" -ForegroundColor Green
Write-Host ("LLM: {0} / TTS: {1} / ASR: {2}" -f $status.llm_backend, $status.tts_backend, $status.asr_backend)
Write-Host ("python: {0}" -f $status.python_executable)

try {
  $webResp = Invoke-WebRequest -Uri $WebBase -Method Get -TimeoutSec 10
  Write-Host "WEB OK: $WebBase (HTTP $($webResp.StatusCode))" -ForegroundColor Green
} catch {
  Write-Host "WEB not ready: $WebBase" -ForegroundColor Yellow
}

Write-Step "2) Project + waveform APIs"
$projects = Invoke-JsonGet "$ApiBase/projects"
if (-not $projects -or $projects.Count -eq 0) {
  throw "No projects found. Create/import a project first."
}

if (-not $ProjectId) {
  $ProjectId = $projects[0].id
  Write-Host "No -ProjectId provided. Using latest project: $ProjectId" -ForegroundColor Yellow
}

$project = Invoke-JsonGet "$ApiBase/projects/$ProjectId"
Write-Host ("Project: {0} ({1})" -f $project.name, $project.id)

$stale = Invoke-JsonGet "$ApiBase/tts/projects/$ProjectId/stale-report"
Write-Host ("stale-report => total={0}, ready={1}, stale={2}, missing={3}" -f $stale.total, $stale.ready_count, $stale.stale_count, $stale.missing_count)

$fullWave = Try-JsonGet "$ApiBase/tts/projects/$ProjectId/waveform?level=1024"
if ($null -eq $fullWave) {
  Write-Host "Full waveform peaks: not found (full synthesis may not be done yet)." -ForegroundColor Yellow
} else {
  Write-Host ("Full waveform peaks: level={0}, data_len={1}" -f $fullWave.level, $fullWave.data.Count) -ForegroundColor Green
}

$segKeys = @()
if ($project.audio_assets -and $project.audio_assets.segments) {
  $segKeys = @($project.audio_assets.segments.PSObject.Properties.Name)
}

if ($segKeys.Count -gt 0) {
  $sampleSegId = $segKeys[0]
  $segWave = Try-JsonGet "$ApiBase/tts/projects/$ProjectId/segments/$sampleSegId/peaks"
  if ($null -eq $segWave) {
    Write-Host "Segment peaks: not found (at least one segment peaks missing)." -ForegroundColor Yellow
  } else {
    $segDataLen = (($segWave.levels."$($segWave.bins)") | Measure-Object).Count
    Write-Host ("Segment peaks: segment={0}, bins={1}, data_len={2}" -f $sampleSegId, $segWave.bins, $segDataLen) -ForegroundColor Green
  }
} else {
  Write-Host "Current project has no segment assets."
}

Write-Step "3) Manual real-page acceptance checklist"
Write-Host "Run these checks in UI:"
Write-Host "  [A] Status card shows project, connection, import button."
Write-Host "  [B] Import ZIP works and does not explode preset count."
Write-Host "  [C] Segment rows show stable waveforms (no frequent fallback players)."
Write-Host "  [D] Single-row regenerate only affects that row."
Write-Host "  [E] Regenerate selected only affects checked rows."
Write-Host "  [F] Full audio waveform (WaveSurfer) shows waveform/timeline/zoom and syncs with playback."
Write-Host "  [G] After page refresh, segment + full waveforms recover quickly."
Write-Host "  [H] Export ZIP then import again, waveform/audio state remains consistent."

Write-Step "4) Suggested evidence capture"
Write-Host ("Record project_id: {0}" -f $ProjectId)
Write-Host "Screenshots:"
Write-Host "  1) Segment list (20+ rows)"
Write-Host "  2) Full waveform area (before/after zoom)"
Write-Host "  3) Single-row regenerate before/after"
Write-Host "  4) First screen after ZIP import"

if ($OpenBrowser) {
  Write-Step "5) Open browser"
  Start-Process $WebBase | Out-Null
  Write-Host "Opened: $WebBase" -ForegroundColor Green
}

Write-Step "Done"
Write-Host "Real page acceptance script completed."
