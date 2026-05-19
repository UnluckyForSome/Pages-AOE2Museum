<#
.SYNOPSIS
  Reconcile livescenarios with R2/D1 (tombstones + catalog), POST sync API, backfill unparsed.

.DESCRIPTION
  See Write-PipelinePlan output when the script runs for a plain-English walkthrough.

.PARAMETER RcloneRemote
  rclone remote path to the scenarios bucket, e.g. "livescenarios:scenarios"

.PARAMETER LiveDir
  Local folder (default: <repo>/livescenarios)

.PARAMETER SiteUrl
  Deployed Worker base URL (default: production). Env SITE_URL overrides.

.PARAMETER SyncSecret
  Bearer token for POST /api/scenarios/sync (wrangler secret put SYNC_SECRET).

.PARAMETER ReconcileDryRun
  Plan only; no local deletes, rclone, or dedupe removals.

.PARAMETER SkipDedupe
  Skip MD5 dedupe inside reconcile (not recommended).

.PARAMETER SkipBackfill
  Skip python backfill.

.PARAMETER SkipSync
  Skip POST /api/scenarios/sync (D1 will not match R2 until sync runs).

.PARAMETER SkipReconcile
  Skip rclone reconcile (POST sync + backfill only).

.PARAMETER LocalRootForBackfill
  Passed as --local-root to backfill (defaults to LiveDir).
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $RcloneRemote,

  [string] $LiveDir = "",

  [string] $SiteUrl = "",

  [string] $SyncSecret = "",

  [switch] $ReconcileDryRun,

  [switch] $SkipDedupe,

  [switch] $SkipBackfill,

  [switch] $SkipSync,

  [switch] $SkipReconcile,

  [string] $LocalRootForBackfill = ""
)

# Keep in sync with PUBLIC_BASE_URL in wrangler.jsonc
$DefaultSiteUrl = "https://aoe2museum.com"

function Write-StageBanner {
  param(
    [string] $Label,
    [int] $Number,
    [int] $Total,
    [string] $Title
  )
  $bar = "=" * 70
  Write-Host ""
  Write-Host $bar -ForegroundColor Cyan
  Write-Host ("  [{0} {1}/{2}] {3}" -f $Label, $Number, $Total, $Title) -ForegroundColor White
  Write-Host $bar -ForegroundColor Cyan
  Write-Host ""
}

function Write-StageDone {
  param(
    [string] $Label,
    [int] $Number,
    [int] $Total,
    [string] $Summary = ""
  )
  $msg = "  [{0} {1}/{2}] DONE" -f $Label, $Number, $Total
  if ($Summary) { $msg = "$msg - $Summary" }
  Write-Host $msg -ForegroundColor Green
  Write-Host ""
}

function Write-StepDetail {
  param([string[]] $Lines)
  foreach ($line in $Lines) {
    Write-Host ("    {0}" -f $line) -ForegroundColor DarkGray
  }
}

function Get-WranglerTargetLabel {
  if ($env:WRANGLER_D1_LOCAL -eq "1") { return "local (wrangler --local)" }
  return "remote (production D1 + R2 via wrangler --remote)"
}

function Write-PipelinePlan {
  param(
    [string] $RepoRoot,
    [string] $LiveDir,
    [string] $RcloneRemote,
    [string] $SiteUrl,
    [string] $SyncUrl,
    [string] $WranglerTarget,
    [bool] $WillReconcile,
    [bool] $WillSync,
    [bool] $WillBackfill,
    [bool] $DryRun
  )

  Write-Host ""
  Write-Host "================================================================" -ForegroundColor Cyan
  Write-Host "  LIVESCENARIOS SYNC PIPELINE" -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Goal: Make these three match each other:" -ForegroundColor White
  Write-Host "  1) Your folder on disk (livescenarios/)" -ForegroundColor White
  Write-Host "  2) Cloudflare R2 bucket 'scenarios' (via rclone)" -ForegroundColor White
  Write-Host "  3) Cloudflare D1 database 'scenarios' (catalog + metadata)" -ForegroundColor White
  Write-Host ""
  Write-Host "CONFIG" -ForegroundColor Yellow
  Write-Host ("  Repo folder     : {0}" -f $RepoRoot)
  Write-Host ("  Local scenarios : {0}" -f $LiveDir)
  Write-Host ("  rclone remote   : {0}" -f $RcloneRemote)
  Write-Host ("  Worker URL      : {0}" -f $SiteUrl)
  Write-Host ("  Sync API        : {0}" -f $SyncUrl)
  Write-Host ("  wrangler D1/R2  : {0}" -f $WranglerTarget)
  if ($DryRun) {
    Write-Host "  Mode            : DRY RUN (no file deletes or rclone transfers)" -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "STEPS THAT WILL RUN" -ForegroundColor Yellow

  $n = 0
  if ($WillReconcile) {
    $n++
    Write-Host ""
    Write-Host ("  [{0}] RECONCILE disk <-> R2 (5 substages)" -f $n) -ForegroundColor White
    Write-StepDetail @(
      "RECONCILE 1/5: Load D1 catalog + tombstones"
      "RECONCILE 2/5: Remove local tombstoned files"
      "RECONCILE 3/5: Download missing catalog files (rclone copy)"
      "RECONCILE 4/5: MD5 dedupe"
      "RECONCILE 5/5: rclone sync (local wins)"
    )
  } else {
    Write-Host ""
    Write-Host "  [skip] RECONCILE (-SkipReconcile or SKIP_RECONCILE=1)" -ForegroundColor Yellow
  }

  if ($WillSync) {
    $n++
    Write-Host ""
    Write-Host ("  [{0}] POST SYNC - align D1 with R2 (deployed Worker)" -f $n) -ForegroundColor White
    Write-StepDetail @(
      "Calls POST /api/scenarios/sync on the live Worker"
      "Inserts new R2 keys into D1, renames moved files, deletes stale rows"
      "Purges tombstoned objects if any remain on R2"
      "Does NOT parse scenario content (that is step 3)"
    )
  } else {
    Write-Host ""
    Write-Host "  [skip] POST SYNC (-SkipSync or ReconcileDryRun)" -ForegroundColor Yellow
  }

  if ($WillBackfill) {
    $n++
    Write-Host ""
    Write-Host ("  [{0}] BACKFILL metadata (python, unparsed rows only)" -f $n) -ForegroundColor White
    Write-StepDetail @(
      "For D1 rows with parsed_at IS NULL: read .scx/.scn bytes"
      "Writes minimap PNG + flattened columns (title, map size, triggers, etc.)"
      "Uses local file when path matches r2_key, else R2 get"
      "Can take a long time for many new files"
    )
  } else {
    Write-Host ""
    Write-Host "  [skip] BACKFILL (-SkipBackfill or ReconcileDryRun)" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host ("Total steps: {0}" -f $n) -ForegroundColor DarkGray
  Write-Host ""
}

function Write-BackfillFailureSummary {
  param([string] $Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue)
  if ($lines.Count -eq 0) { return }

  Write-Host ""
  Write-Host ("=" * 70) -ForegroundColor Red
  Write-Host ("  PARSE FAILURES ({0})" -f $lines.Count) -ForegroundColor Red
  Write-Host ("=" * 70) -ForegroundColor Red
  Write-Host ""

  foreach ($line in $lines) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split "`t", 4
    $name = $parts[0]
    $key = if ($parts.Count -gt 1) { $parts[1] } else { "" }
    $id = if ($parts.Count -gt 2) { $parts[2] } else { "" }
    $err = if ($parts.Count -gt 3) { $parts[3] } else { "" }
    Write-Host ("  {0}" -f $name) -ForegroundColor Yellow
    if ($id) { Write-Host ("    id  : {0}" -f $id) -ForegroundColor DarkGray }
    if ($key) { Write-Host ("    key : {0}" -f $key) -ForegroundColor DarkGray }
    if ($err) { Write-Host ("    err : {0}" -f $err) -ForegroundColor DarkGray }
  }
  Write-Host ""
  Write-Host ("  Full list: {0}" -f $Path) -ForegroundColor DarkGray
  Write-Host ""
}

function Get-SyncHttpErrorDetail {
  param($ErrorRecord)
  $msg = $ErrorRecord.Exception.Message
  $resp = $ErrorRecord.Exception.Response
  if ($null -eq $resp) {
    return $msg
  }
  try {
    $code = [int]$resp.StatusCode
    $stream = $resp.GetResponseStream()
    if ($null -eq $stream) {
      return "HTTP $code - $msg"
    }
    $reader = New-Object System.IO.StreamReader($stream)
    $body = $reader.ReadToEnd()
    $reader.Close()
    if ($body) {
      return "HTTP $code - $body"
    }
    return "HTTP $code - $msg"
  } catch {
    return $msg
  }
}

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $LiveDir) {
  $LiveDir = Join-Path $RepoRoot "livescenarios"
}
if (-not (Test-Path -LiteralPath $LiveDir)) {
  New-Item -ItemType Directory -Path $LiveDir -Force | Out-Null
  Write-Host "Created local folder: $LiveDir" -ForegroundColor DarkGray
}

if (-not $SyncSecret) {
  $SyncSecret = $env:SYNC_SECRET
}
if (-not $SyncSecret) {
  Write-Error "Set SYNC_SECRET env or pass -SyncSecret (same value as: wrangler secret put SYNC_SECRET)."
}

if (-not $SiteUrl) {
  $SiteUrl = $env:SITE_URL
}
if (-not $SiteUrl) {
  $SiteUrl = $DefaultSiteUrl
}

$SiteUrl = $SiteUrl.TrimEnd("/")
$syncUrl = "$SiteUrl/api/scenarios/sync"
$wranglerTarget = Get-WranglerTargetLabel

$willReconcile = -not $SkipReconcile
$willSync = (-not $SkipSync) -and (-not $ReconcileDryRun)
$willBackfill = (-not $SkipBackfill) -and (-not $ReconcileDryRun)
$stepTotal = (@($willReconcile, $willSync, $willBackfill) | Where-Object { $_ }).Count
$stepNum = 0

Write-PipelinePlan `
  -RepoRoot $RepoRoot `
  -LiveDir $LiveDir `
  -RcloneRemote $RcloneRemote `
  -SiteUrl $SiteUrl `
  -SyncUrl $syncUrl `
  -WranglerTarget $wranglerTarget `
  -WillReconcile $willReconcile `
  -WillSync $willSync `
  -WillBackfill $willBackfill `
  -DryRun $ReconcileDryRun.IsPresent

$reconcilePy = Join-Path $RepoRoot "scripts\reconcile-livescenarios.py"
$reconcileArgs = @(
  "--root", $LiveDir,
  "--rclone-remote", $RcloneRemote
)
if ($ReconcileDryRun) { $reconcileArgs += "--dry-run" }
if ($SkipDedupe) { $reconcileArgs += "--skip-dedupe" }

if ($willReconcile) {
  $stepNum++
  Write-StageBanner -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Title "Reconcile disk and R2 (see RECONCILE 1/5 .. 5/5 below)"
  Write-StepDetail @(
    "Command: python scripts\reconcile-livescenarios.py"
    "Local livescenarios\ is authoritative for what remains on R2"
  )
  Push-Location $RepoRoot
  try {
    python $reconcilePy @reconcileArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
  Write-StageDone -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Summary "disk and R2 aligned"
}

if ($ReconcileDryRun) {
  Write-Host ""
  Write-Host "ReconcileDryRun: stopping before POST sync and backfill." -ForegroundColor Yellow
  $sw.Stop()
  Write-Host ("Elapsed: {0:g}" -f $sw.Elapsed) -ForegroundColor DarkGray
  exit 0
}

if ($willSync) {
  $stepNum++
  Write-StageBanner -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Title "POST sync - update D1 to match R2"
  Write-StepDetail @(
    "Deployed Worker (not npm run dev)"
    ("POST {0}" -f $syncUrl)
    "Auth: Bearer SYNC_SECRET"
  )
  $headers = @{ Authorization = "Bearer $SyncSecret" }
  try {
    Write-Host "    waiting for Worker response..." -ForegroundColor DarkGray
    $result = Invoke-RestMethod -Uri $syncUrl -Method Post -Headers $headers -TimeoutSec 600
    $result | ConvertTo-Json
    Write-StageDone -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Summary "D1 rows match R2 keys"
  } catch {
    $detail = Get-SyncHttpErrorDetail -ErrorRecord $_
    Write-Host ""
    Write-Host "POST sync error: $detail" -ForegroundColor Red
    Write-Host ""
    Write-Error @"
POST sync failed ($syncUrl).

Common fixes:
  1. SYNC_SECRET must match production (wrangler secret put SYNC_SECRET)
  2. Deploy latest Worker (npm run deploy) if you changed sync/tombstone code
  3. Re-run sync only: add -SkipReconcile (or set SKIP_RECONCILE=1 in the .bat)
  4. Local wrangler dev only: set SITE_URL=http://localhost:8787 and npm run dev
  5. Or skip HTTP sync: -SkipSync
"@
  }
}

if (-not $willBackfill) {
  Write-Host ""
  Write-Host "Backfill skipped (-SkipBackfill)." -ForegroundColor Yellow
  $sw.Stop()
  Write-Host ""
  Write-Host "================================================================" -ForegroundColor Green
  Write-Host "  PIPELINE FINISHED" -ForegroundColor Green
  Write-Host ("  Elapsed: {0:g}" -f $sw.Elapsed) -ForegroundColor Green
  Write-Host "================================================================" -ForegroundColor Green
  exit 0
}

if ($env:WRANGLER_D1_LOCAL -eq "1") {
  Write-Warning "WRANGLER_D1_LOCAL=1: backfill uses LOCAL D1/R2. Unset for production."
}

$stepNum++
Write-StageBanner -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Title "Backfill unparsed metadata (see BACKFILL 1/2 .. 2/2 below)"
Write-StepDetail @(
  "Command: python scripts\backfill-scenario-metadata.py --only-unparsed"
  ("Local bytes when possible: --local-root ""{0}""" -f $(if ($LocalRootForBackfill) { $LocalRootForBackfill } else { $LiveDir }))
)

$py = Join-Path $RepoRoot "scripts\backfill-scenario-metadata.py"
$failuresOut = Join-Path $RepoRoot "scripts\.last-backfill-failures.tsv"
$localArg = @()
$lr = $LocalRootForBackfill
if (-not $lr) { $lr = $LiveDir }
if ($lr) {
  $localArg = @("--local-root", $lr)
}

$backfillExit = 0
Push-Location $RepoRoot
try {
  python $py --only-unparsed --failures-out $failuresOut @localArg
  $backfillExit = $LASTEXITCODE
} finally {
  Pop-Location
}
Write-StageDone -Label "PIPELINE" -Number $stepNum -Total $stepTotal -Summary "backfill finished"

$sw.Stop()
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  PIPELINE FINISHED" -ForegroundColor Green
Write-Host ("  Elapsed: {0:g}" -f $sw.Elapsed) -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-BackfillFailureSummary -Path $failuresOut
if ($backfillExit -ne 0) { exit $backfillExit }
