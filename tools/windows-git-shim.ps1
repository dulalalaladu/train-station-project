<#
.SYNOPSIS
  Make Paperclip's managed GitHub credentials work for git on a Windows host.

.DESCRIPTION
  Paperclip injects a credential launcher directory ($env:PAPERCLIP_GITHUB_LAUNCHER_DIR)
  that contains extension-less Node scripts named `git` and `gh`. Those scripts fetch a
  short-lived GitHub credential from the Paperclip broker and then spawn the "real" git,
  which they locate by searching every PATH directory for a file literally named `git`.
  On Windows the real binary is `git.exe`, so the lookup fails with:

      Paperclip: requested GitHub command is not installed.

  This script creates a small shim directory containing
    - `git`      an empty marker file that satisfies the launcher's existence check, and
    - `git.exe`  a copy of Git for Windows' `cmd\git.exe` launcher
  plus junctions (`mingw64`, `usr`, `etc`) so the copied launcher can find the real Git
  installation. It prepends the shim to $env:PATH for the current process only and
  defines a `pgit` function that runs git through the Paperclip launcher.

.USAGE
  . .\tools\windows-git-shim.ps1          # dot-source once per PowerShell session
  pgit status
  pgit push -u origin feat/T-001-monorepo-skeleton

  Commits need an identity because the launcher sets user.useConfigOnly=true:
  git config user.name  "RailVoice A-7"
  git config user.email "railvoice-a7@users.noreply.github.com"

.NOTES
  Nothing here stores or prints credentials; the launcher keeps them in the child
  process environment only. Remove the shim with: Remove-Item -Recurse -Force $env:TEMP\paperclip-gitshim
#>

$ErrorActionPreference = 'Stop'

$gitRoot = 'C:\Program Files\Git'
if ($env:RAILVOICE_GIT_ROOT) { $gitRoot = $env:RAILVOICE_GIT_ROOT }
if (-not (Test-Path (Join-Path $gitRoot 'cmd\git.exe'))) {
  throw "Git for Windows not found under $gitRoot. Set RAILVOICE_GIT_ROOT to the installation root."
}
if (-not $env:PAPERCLIP_GITHUB_LAUNCHER_DIR -or -not (Test-Path (Join-Path $env:PAPERCLIP_GITHUB_LAUNCHER_DIR 'git'))) {
  throw 'PAPERCLIP_GITHUB_LAUNCHER_DIR is not set or has no git launcher; run this inside a Paperclip run.'
}

$shim = Join-Path $env:TEMP 'paperclip-gitshim'
$cmdDir = Join-Path $shim 'cmd'
New-Item -ItemType Directory -Force $cmdDir | Out-Null
Copy-Item (Join-Path $gitRoot 'cmd\git.exe') (Join-Path $cmdDir 'git.exe') -Force
Set-Content -Path (Join-Path $cmdDir 'git') -Value 'marker file for the Paperclip GitHub launcher lookup' -NoNewline
foreach ($dir in @('mingw64', 'usr', 'etc')) {
  $link = Join-Path $shim $dir
  if (-not (Test-Path $link)) {
    New-Item -ItemType Junction -Path $link -Target (Join-Path $gitRoot $dir) | Out-Null
  }
}

if (-not (($env:PATH -split ';') -contains $cmdDir)) {
  $env:PATH = "$cmdDir;$env:PATH"
}

function global:pgit {
  & node (Join-Path $env:PAPERCLIP_GITHUB_LAUNCHER_DIR 'git') @args
}

$version = & node (Join-Path $env:PAPERCLIP_GITHUB_LAUNCHER_DIR 'git') --version
Write-Host "Paperclip git shim ready: $version  (use 'pgit <args>' for any command that talks to GitHub)"
