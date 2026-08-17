# DSH Desktop 图标生成脚本
# 用 GDI+ 绘制 256x256 极简图标（白底 + 深色 DSH 标记 + 强调色圆点），
# 输出 resources/icon.png、resources/icon.ico（PNG 压缩 ICO，Vista+ 支持）与 tray.png。
Add-Type -AssemblyName System.Drawing

Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(255, 255, 255, 255))

# 强调色圆点
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 90, 103, 216))
$g.FillEllipse($accent, 196, 28, 34, 34)

# 主标记：圆角方 + DSH
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 26, 26, 26))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(56, 56, 40, 40, 180, 90)
$path.AddArc(160, 56, 40, 40, 270, 90)
$path.AddArc(160, 160, 40, 40, 0, 90)
$path.AddArc(56, 160, 40, 40, 90, 90)
$path.CloseFigure()
$g.FillPath($bg, $path)

$font = New-Object System.Drawing.Font("Segoe UI", 78, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(56, 44, 144, 144)
$g.DrawString("DSH", $font, $white, $rect, $sf)

$g.Dispose()
$bmp.Save("$PSScriptRoot\..\resources\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# tray.png 16x16（缩放）
$tray = New-Object System.Drawing.Bitmap($bmp, 16, 16)
$tray.Save("$PSScriptRoot\..\resources\tray.png", [System.Drawing.Imaging.ImageFormat]::Png)
$tray.Dispose()

# ICO 容器（内嵌 PNG，Vista+）
$pngPath = "$PSScriptRoot\..\resources\icon.png"
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = "$PSScriptRoot\..\resources\icon.ico"
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0)      # reserved
$bw.Write([UInt16]1)      # type: icon
$bw.Write([UInt16]1)      # count
$bw.Write([Byte]0)        # width (256 => 0)
$bw.Write([Byte]0)        # height (256 => 0)
$bw.Write([Byte]0)        # palette
$bw.Write([Byte]0)        # reserved
$bw.Write([UInt16]1)      # color planes
$bw.Write([UInt16]32)     # bpp
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)     # offset to PNG data
$bw.Write([byte[]]$pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$ms.Dispose()

Write-Host "图标已生成: resources/icon.ico, icon.png, tray.png"
