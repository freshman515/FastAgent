Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$iconsDir = Join-Path $root 'assets/icons'
$buildDir = Join-Path $root 'build'

function Scale-IconValue([double]$value, [int]$size) {
  return [float]($value * $size / 512.0)
}

function New-RoundedRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = [float]($radius * 2)
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconGradient([int]$size, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [string]$color1, [string]$color2) {
  $point1 = New-Object System.Drawing.PointF -ArgumentList (Scale-IconValue $x1 $size), (Scale-IconValue $y1 $size)
  $point2 = New-Object System.Drawing.PointF -ArgumentList (Scale-IconValue $x2 $size), (Scale-IconValue $y2 $size)
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList `
    $point1, `
    $point2, `
    ([System.Drawing.ColorTranslator]::FromHtml($color1)), `
    ([System.Drawing.ColorTranslator]::FromHtml($color2))
}

function Fill-RoundedRect($graphics, [int]$size, [double]$x, [double]$y, [double]$width, [double]$height, [double]$radius, $brush, $pen = $null) {
  $path = New-RoundedRectPath `
    (Scale-IconValue $x $size) `
    (Scale-IconValue $y $size) `
    (Scale-IconValue $width $size) `
    (Scale-IconValue $height $size) `
    (Scale-IconValue $radius $size)
  $graphics.FillPath($brush, $path)
  if ($null -ne $pen) {
    $graphics.DrawPath($pen, $path)
  }
  $path.Dispose()
}

function Draw-IconLine($graphics, [int]$size, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [double]$width, $brush) {
  $pen = New-Object System.Drawing.Pen -ArgumentList $brush, (Scale-IconValue $width $size)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine(
    $pen,
    (Scale-IconValue $x1 $size),
    (Scale-IconValue $y1 $size),
    (Scale-IconValue $x2 $size),
    (Scale-IconValue $y2 $size)
  )
  $pen.Dispose()
}

function Fill-IconCircle($graphics, [int]$size, [double]$centerX, [double]$centerY, [double]$radius, [string]$color) {
  $brush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml($color))
  $diameter = Scale-IconValue ($radius * 2) $size
  $graphics.FillEllipse(
    $brush,
    (Scale-IconValue ($centerX - $radius) $size),
    (Scale-IconValue ($centerY - $radius) $size),
    $diameter,
    $diameter
  )
  $brush.Dispose()
}

function Save-AppIconPng([int]$size, [string]$path) {
  $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $background = New-IconGradient $size 76 34 438 474 '#17202a' '#05070b'
  Fill-RoundedRect $graphics $size 0 0 512 512 116 $background
  $background.Dispose()

  $borderPen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(24, 255, 255, 255)), (Scale-IconValue 2 $size)
  $transparent = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::Transparent)
  Fill-RoundedRect $graphics $size 16 16 480 480 104 $transparent $borderPen
  $transparent.Dispose()
  $borderPen.Dispose()

  $glow = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(96, 139, 92, 246))
  Draw-IconLine $graphics $size 172 184 254 256 80 $glow
  Draw-IconLine $graphics $size 254 256 172 328 80 $glow
  Draw-IconLine $graphics $size 298 342 374 342 72 $glow
  $glow.Dispose()

  $prompt = New-IconGradient $size 130 166 382 358 '#f5f3ff' '#8b5cf6'
  Draw-IconLine $graphics $size 172 184 254 256 54 $prompt
  Draw-IconLine $graphics $size 254 256 172 328 54 $prompt

  $cursor = New-IconGradient $size 266 344 386 344 '#ddd6fe' '#a855f7'
  Draw-IconLine $graphics $size 298 342 374 342 48 $cursor

  $prompt.Dispose()
  $cursor.Dispose()
  $graphics.Dispose()
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function Write-PngIco([string]$icoPath, [string[]]$pngPaths) {
  $entries = @()
  foreach ($pngPath in $pngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($pngPath)
    $image = [System.Drawing.Image]::FromFile($pngPath)
    $entries += [pscustomobject]@{
      Width = [int]$image.Width
      Height = [int]$image.Height
      Bytes = $bytes
    }
    $image.Dispose()
  }

  $stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = New-Object System.IO.BinaryWriter -ArgumentList $stream
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$entries.Count)

  $offset = 6 + (16 * $entries.Count)
  foreach ($entry in $entries) {
    $writer.Write([byte]$(if ($entry.Width -ge 256) { 0 } else { $entry.Width }))
    $writer.Write([byte]$(if ($entry.Height -ge 256) { 0 } else { $entry.Height }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
  }

  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }
  $writer.Dispose()
  $stream.Dispose()
}

foreach ($size in @(16, 32, 64, 128, 256, 512, 1024)) {
  Save-AppIconPng $size (Join-Path $iconsDir "fastagents-$size.png")
}

Copy-Item -LiteralPath (Join-Path $iconsDir 'fastagents-512.png') -Destination (Join-Path $buildDir 'icon.png') -Force
Copy-Item -LiteralPath (Join-Path $iconsDir 'fastagents-64.png') -Destination (Join-Path $root 'src/renderer/assets/icons/pragma-desk.png') -Force

$temporary48 = Join-Path $env:TEMP 'pragma-desk-icon-48.png'
Save-AppIconPng 48 $temporary48
Write-PngIco (Join-Path $buildDir 'icon.ico') @(
  (Join-Path $iconsDir 'fastagents-16.png'),
  (Join-Path $iconsDir 'fastagents-32.png'),
  $temporary48,
  (Join-Path $iconsDir 'fastagents-64.png'),
  (Join-Path $iconsDir 'fastagents-128.png'),
  (Join-Path $iconsDir 'fastagents-256.png')
)
Remove-Item -LiteralPath $temporary48 -Force

Write-Output 'Generated Pragma Desk app icons.'
