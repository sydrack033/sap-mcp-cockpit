# Gera build/icon.ico (engrenagem steampunk) sem dependencias externas.
# Desenha a engrenagem com System.Drawing em 256px, reamostra pros tamanhos
# menores e empacota tudo num .ico com entradas PNG.
Add-Type -AssemblyName System.Drawing

function New-GearBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [double]$size
  $cx = $s / 2.0
  $cy = $s / 2.0

  # --- fundo: quadrado arredondado escuro ---
  $bg   = [System.Drawing.Color]::FromArgb(255, 28, 23, 18)   # #1c1712
  $rad  = $s * 0.18
  $rect = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $rad * 2.0
  $rect.AddArc(0.0, 0.0, $d, $d, 180, 90)
  $rect.AddArc($s - $d, 0.0, $d, $d, 270, 90)
  $rect.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
  $rect.AddArc(0.0, $s - $d, $d, $d, 90, 90)
  $rect.CloseFigure()
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $g.FillPath($bgBrush, $rect)

  # --- engrenagem ---
  $teeth = 10
  $Rt = $s * 0.42   # ponta do dente
  $Rr = $s * 0.345  # raiz (vale)
  $step = (2.0 * [Math]::PI) / $teeth
  # perfil de um dente (fracao do periodo -> raio): topo chato + vale chato
  $profile = @(@(0.06, $Rt), @(0.34, $Rt), @(0.44, $Rr), @(0.94, $Rr))

  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  for ($k = 0; $k -lt $teeth; $k++) {
    foreach ($p in $profile) {
      $ang = ($k + $p[0]) * $step - [Math]::PI / 2.0
      $r   = [double]$p[1]
      $x   = $cx + $r * [Math]::Cos($ang)
      $y   = $cy + $r * [Math]::Sin($ang)
      $pts.Add((New-Object System.Drawing.PointF([single]$x, [single]$y)))
    }
  }

  $gear = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gear.AddPolygon($pts.ToArray())
  $gear.CloseFigure()

  # gradiente cobre (mesma paleta do app)
  $c1 = [System.Drawing.Color]::FromArgb(255, 224, 149, 79)  # #e0954f
  $c2 = [System.Drawing.Color]::FromArgb(255, 201, 123, 60)  # #c97b3c
  $grect = New-Object System.Drawing.RectangleF(0, 0, [single]$s, [single]$s)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($grect, $c1, $c2, 90.0)
  $g.FillPath($grad, $gear)

  # furo central (volta o fundo) + cubo
  $holeR = $s * 0.135
  $g.FillEllipse($bgBrush, [single]($cx - $holeR), [single]($cy - $holeR), [single]($holeR * 2), [single]($holeR * 2))
  $hubR = $s * 0.205
  $hubPen = New-Object System.Drawing.Pen($c1, [single]($s * 0.028))
  $g.DrawEllipse($hubPen, [single]($cx - $hubR), [single]($cy - $hubR), [single]($hubR * 2), [single]($hubR * 2))

  $g.Dispose()
  return $bmp
}

$sizes = @(256, 128, 64, 48, 32, 16)
$base = New-GearBitmap 256
$base.Save((Join-Path $PSScriptRoot 'icon-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$pngs = @()
foreach ($sz in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.DrawImage($base, 0, 0, $sz, $sz)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,@{ size = $sz; bytes = $ms.ToArray() }
  $bmp.Dispose()
}

# --- monta o .ico (entradas PNG) ---
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0)            # reserved
$bw.Write([UInt16]1)            # type = icon
$bw.Write([UInt16]$pngs.Count)  # count

$offset = 6 + (16 * $pngs.Count)
foreach ($p in $pngs) {
  $w = $p.size; if ($w -ge 256) { $w = 0 }
  $bw.Write([Byte]$w)                 # width  (0 => 256)
  $bw.Write([Byte]$w)                 # height (0 => 256)
  $bw.Write([Byte]0)                  # color count
  $bw.Write([Byte]0)                  # reserved
  $bw.Write([UInt16]1)               # planes
  $bw.Write([UInt16]32)              # bit count
  $bw.Write([UInt32]$p.bytes.Length) # bytes in res
  $bw.Write([UInt32]$offset)         # offset
  $offset += $p.bytes.Length
}
foreach ($p in $pngs) { $bw.Write($p.bytes) }
$bw.Flush()

$icoPath = Join-Path $PSScriptRoot 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$bw.Dispose(); $base.Dispose()
Write-Output "icon.ico gerado: $icoPath ($((Get-Item $icoPath).Length) bytes)"
