param(
  [Parameter(Mandatory = $true)][string]$SourceImage,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path -LiteralPath $SourceImage).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
$pixelsPerMm = 4
$cases = @(
  @{ id = "elderly-hollow-4mm"; shape = "hollow"; diameterMm = 4; x = 410; y = 635; tier = "required" },
  @{ id = "elderly-hollow-6mm"; shape = "hollow"; diameterMm = 6; x = 835; y = 640; tier = "regression" },
  @{ id = "elderly-solid-4mm"; shape = "solid"; diameterMm = 4; x = 455; y = 735; tier = "required" },
  @{ id = "elderly-solid-5mm"; shape = "solid"; diameterMm = 5; x = 805; y = 745; tier = "regression" },
  @{ id = "elderly-solid-6mm"; shape = "solid"; diameterMm = 6; x = 650; y = 785; tier = "regression" },
  @{ id = "elderly-solid-2mm-limit"; shape = "solid"; diameterMm = 2; x = 500; y = 680; tier = "limit_only" },
  @{ id = "elderly-solid-3mm-challenge"; shape = "solid"; diameterMm = 3; x = 760; y = 690; tier = "challenge" },
  @{ id = "elderly-hollow-8mm-regression"; shape = "hollow"; diameterMm = 8; x = 645; y = 390; tier = "regression" }
)

$manifestCases = foreach ($case in $cases) {
  $diameterPx = [int][Math]::Round($case.diameterMm * $pixelsPerMm)
  $radius = $diameterPx / 2.0
  $image = [System.Drawing.Bitmap]::FromFile($sourcePath)
  $mask = New-Object System.Drawing.Bitmap($image.Width, $image.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($image)
  $maskGraphics = [System.Drawing.Graphics]::FromImage($mask)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $maskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $maskGraphics.Clear([System.Drawing.Color]::Black)
    $box = New-Object System.Drawing.RectangleF(($case.x - $radius), ($case.y - $radius), $diameterPx, $diameterPx)
    if ($case.shape -eq "solid") {
      $lesionBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 18, 16, 14))
      $maskBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
      try { $graphics.FillEllipse($lesionBrush, $box); $maskGraphics.FillEllipse($maskBrush, $box) }
      finally { $lesionBrush.Dispose(); $maskBrush.Dispose() }
    } else {
      $strokePx = [Math]::Max(2, [Math]::Round($pixelsPerMm * 0.75))
      $lesionPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 20, 18, 16), $strokePx)
      $maskPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $strokePx)
      try { $graphics.DrawEllipse($lesionPen, $box); $maskGraphics.DrawEllipse($maskPen, $box) }
      finally { $lesionPen.Dispose(); $maskPen.Dispose() }
    }
    $imageFile = "$($case.id).png"
    $maskFile = "$($case.id)-mask.png"
    $image.Save((Join-Path $outputPath $imageFile), [System.Drawing.Imaging.ImageFormat]::Png)
    $mask.Save((Join-Path $outputPath $maskFile), [System.Drawing.Imaging.ImageFormat]::Png)
    [ordered]@{
      id = $case.id; base_image_sha256 = $sourceHash; image = $imageFile; mask = $maskFile
      center_px = @($case.x, $case.y); designed_diameter_mm = $case.diameterMm
      actual_diameter_px = $diameterPx; pixels_per_mm = $pixelsPerMm; morphology = $case.shape
      tier = $case.tier; expected = if ($case.diameterMm -ge 4) { "detect" } else { "measure_only" }
    }
  } finally {
    $graphics.Dispose(); $maskGraphics.Dispose(); $image.Dispose(); $mask.Dispose()
  }
}

$manifest = [ordered]@{
  schema = "small-lesion-calibration-set/v1"
  source_image = $sourcePath
  source_image_sha256 = $sourceHash
  image_size_px = @(1254, 1254)
  pixels_per_mm = $pixelsPerMm
  calibration_scope = "engineering_fixture_only"
  clinical_claim = $false
  cases = $manifestCases
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath "manifest.json") -Encoding utf8
