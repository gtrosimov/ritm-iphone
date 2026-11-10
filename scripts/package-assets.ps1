[CmdletBinding()]
param(
    [string]$Source = (Join-Path $PSScriptRoot '..\..\..\outputs\Ritm')
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$SourceRoot = [IO.Path]::GetFullPath($Source)
$Destination = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'RitmNative\WebAssets'))
if (-not $Destination.StartsWith($ProjectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Destination escapes project root.'
}
# Deliberate allowlist. Never copy the source directory wholesale: it contains
# local TLS material and helper programs which must not enter an app bundle.
$RootFiles = @(
    'index.html', 'app.mjs', 'core.mjs', 'program.mjs', 'moves.mjs',
    'technique.mjs', 'workout-editor.mjs', 'nutrition.mjs', 'attendance.mjs',
    'running.mjs', 'media-catalog.mjs', 'media-manifest.json',
    'style.css', 'nutrition.css', 'attendance.css', 'running.css',
    'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'
)
$OptionalFiles = @('native-bridge.mjs', 'running-route.mjs', 'running-route.css', 'route-core.mjs', 'route.mjs', 'native.mjs', 'routes.mjs', 'routes.css', 'band.mjs', 'band.css', 'device-health.mjs', 'device-health.css')
$AllowedExtensions = @('.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.mp4', '.woff2', '.json', '.js', '.css', '.txt')
function Assert-SafePath([string]$Relative) {
    $Parts = $Relative.Replace('\', '/').Split('/')
    if ($Parts -contains '.local' -or $Parts -contains '..' -or ($Parts | Where-Object { $_.StartsWith('.') -or $_ -eq '' })) {
        throw "Disallowed bundle path: $Relative"
    }
}
function Copy-Asset([string]$Relative) {
    Assert-SafePath $Relative
    $Original = [IO.Path]::GetFullPath((Join-Path $SourceRoot $Relative))
    if (-not $Original.StartsWith($SourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escape.' }
    # Check every ancestor: Resolve-Path alone does not reject directory junctions.
    $Check = Get-Item -LiteralPath $Original -Force
    while ($Check.FullName -ne $SourceRoot) {
        if (($Check.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Link is not allowed: $Relative" }
        $Check = if ($Check -is [IO.DirectoryInfo]) { $Check.Parent } else { $Check.Directory }
        if ($null -eq $Check) { throw 'Source ancestor mismatch.' }
    }
    $Target = Join-Path $Destination $Relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
    [IO.File]::Copy($Original, $Target, $true)
    $script:Copied.Add($Relative.Replace('\', '/'))
}
# Only this verified, fixed bundle output may be replaced.
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$Copied = [Collections.Generic.List[string]]::new()
foreach ($Relative in $RootFiles) { Copy-Asset $Relative }
foreach ($Relative in $OptionalFiles) { if (Test-Path -LiteralPath (Join-Path $SourceRoot $Relative) -PathType Leaf) { Copy-Asset $Relative } }
foreach ($Folder in @('media', 'vendor')) {
    $FolderPath = Join-Path $SourceRoot $Folder
    if (-not (Test-Path -LiteralPath $FolderPath -PathType Container)) { continue }
    if (((Get-Item -LiteralPath $FolderPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Asset folder cannot be a link.' }
    foreach ($File in (Get-ChildItem -LiteralPath $FolderPath -File -Recurse -Force)) {
        if ($AllowedExtensions -notcontains $File.Extension.ToLowerInvariant()) { continue }
        $Relative = $File.FullName.Substring($SourceRoot.Length + 1)
        Copy-Asset $Relative
    }
}
$IndexPath = Join-Path $Destination 'index.html'
$Index = [IO.File]::ReadAllText($IndexPath)
# Offline-first bundle. Only optional OpenStreetMap tile images may use network.
# Barcode lookup has one explicit API destination; no general network access.
$Policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://world.openfoodfacts.org; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'none'"
$Meta = '<meta http-equiv="Content-Security-Policy" content="' + $Policy + '">'
$Index = $Index.Replace('<head>', '<head>' + $Meta)
[IO.File]::WriteAllText($IndexPath, $Index, [Text.UTF8Encoding]::new($false))
$Manifest = @{ version = 1; files = @($Copied | Sort-Object) } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $Destination 'asset-manifest.json'), $Manifest, [Text.UTF8Encoding]::new($false))
Write-Output "Packaged $($Copied.Count) allowlisted assets. Source private directories were not copied."

# Public-safe default: programs and results are restored locally on the iPhone.
[IO.File]::WriteAllText((Join-Path $Destination 'program.mjs'), "export const EXERCISES={};`nexport const WORKOUTS=[];`n", [Text.UTF8Encoding]::new($false))
