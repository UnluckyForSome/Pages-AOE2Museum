#!/usr/bin/env pwsh
# UpdateMuseumDependencies — wrapper for scripts/update-museum-dependencies.mjs
# Usage: .\scripts\Update-MuseumDependencies.ps1 -DryRun
#        .\scripts\Update-MuseumDependencies.ps1 -Deploy -AllowDirty -Message "sync deps"

param(
    [switch]$DryRun,
    [switch]$Deploy,
    [switch]$SkipPublish,
    [switch]$AllowDirty,
    [switch]$Force,
    [switch]$PublishUnchanged,
    [switch]$NoBump,
    [ValidateSet("patch", "minor", "major")]
    [string]$Bump = "patch",
    [string]$Only,
    [string]$Message
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MuseumRoot = Split-Path -Parent $ScriptDir
Set-Location $MuseumRoot

$argsList = @()
if ($DryRun) { $argsList += "--dry-run" }
if ($Deploy) { $argsList += "--deploy" }
if ($SkipPublish) { $argsList += "--skip-publish" }
if ($AllowDirty) { $argsList += "--allow-dirty" }
if ($Force) { $argsList += "--force" }
if ($PublishUnchanged) { $argsList += "--publish-unchanged" }
if ($NoBump) { $argsList += "--no-bump" }
else { $argsList += "--bump", $Bump }
if ($Only) { $argsList += "--only", $Only }
if ($Message) { $argsList += "--message", $Message }

node (Join-Path $ScriptDir "update-museum-dependencies.mjs") @argsList
