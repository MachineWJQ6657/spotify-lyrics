Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$pngPath = Join-Path $outputDirectory 'icon.png'
$icoPath = Join-Path $outputDirectory 'icon.ico'
$iconSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$masterSize = 2048
$designSize = 256
$scale = $masterSize / $designSize

function New-BrandMaster {
  $bitmap = [System.Drawing.Bitmap]::new($masterSize, $masterSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.ScaleTransform($scale, $scale)

  $green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 30, 215, 96))
  $ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 4, 9, 6))
  $stem = [System.Drawing.Pen]::new($ink.Color, 24)
  $stem.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $stem.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  # Keep a small transparent gutter so the disc remains crisp in the taskbar.
  $graphics.FillEllipse($green, 14, 14, 228, 228)

  # A deliberately bold single eighth note remains legible at 16px.
  $graphics.DrawLine($stem, 139, 69, 139, 174)
  $flag = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $flag.AddBezier(139, 57, 177, 60, 196, 80, 190, 115)
  $flag.AddBezier(176, 98, 159, 91, 139, 92, 139, 57)
  $flag.CloseFigure()
  $graphics.FillPath($ink, $flag)

  $state = $graphics.Save()
  $graphics.TranslateTransform(109, 181)
  $graphics.RotateTransform(-11)
  $graphics.FillEllipse($ink, -35, -24, 70, 48)
  $graphics.Restore($state)

  $flag.Dispose()
  $stem.Dispose()
  $green.Dispose()
  $ink.Dispose()
  $graphics.Dispose()
  return $bitmap
}

function ConvertTo-PngBytes([System.Drawing.Bitmap]$master, [int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($master, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $master.Width, $master.Height, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()

  $memory = [System.IO.MemoryStream]::new()
  $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $memory.ToArray()
  $memory.Dispose()
  $bitmap.Dispose()
  return $bytes
}

$master = New-BrandMaster
$frames = foreach ($size in $iconSizes) {
  $bytes = ConvertTo-PngBytes $master $size
  if ($size -eq 256) { [System.IO.File]::WriteAllBytes($pngPath, $bytes) }
  [PSCustomObject]@{ Size = $size; Bytes = $bytes }
}
$master.Dispose()

# ICO supports PNG-compressed frames. Supplying each common DPI size prevents
# Windows from applying its own visibly jagged one-size-fits-all downsampling.
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
foreach ($frame in $frames) {
  $dimension = if ($frame.Size -eq 256) { [byte]0 } else { [byte]$frame.Size }
  $writer.Write($dimension)
  $writer.Write($dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frame.Bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
$stream.Dispose()

Write-Host "Generated $pngPath"
Write-Host "Generated $icoPath with sizes: $($iconSizes -join ', ')"
