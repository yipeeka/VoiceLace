param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $PythonArgs
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (!(Test-Path $Python)) {
  throw "Project virtualenv Python was not found at $Python. Create it with: python -m venv .venv"
}

& $Python @PythonArgs
exit $LASTEXITCODE
