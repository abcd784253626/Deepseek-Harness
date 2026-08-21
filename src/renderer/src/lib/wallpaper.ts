/**
 * 壁纸对齐工具：让 webview 内注入的壁纸背景与壳层（.wallpaper-layer）的
 * full-window cover 裁剪完全对齐，使整窗看起来是「一整张连续壁纸」而非分层。
 *
 * 原理：壳层用 `background-size: cover; background-position: center` 铺满全窗口
 * （视口 W×H），得到一个居中裁剪的缩放图。webview 是独立不透明表面，必须自己
 * 渲染壁纸；只要把它看到的子区域对齐到壳层裁剪的对应位置即可无缝衔接：
 *   - background-size  = 壳层同一缩放尺寸（sw × sh）
 *   - background-position = -(裁剪区左上角 + webview 偏移)
 */

/** 通过 Image 读取壁纸原图尺寸（自然尺寸，单位像素） */
export function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('壁纸加载失败'))
    img.src = src
  })
}

export interface AlignInput {
  /** 壳层视口（全窗口）尺寸，CSS 像素 */
  viewportW: number
  viewportH: number
  /** webview 元素在壳层视口中的几何（getBoundingClientRect），CSS 像素 */
  rect: { x: number; y: number; width: number; height: number }
  /** 壁纸原图尺寸（图像像素） */
  imageW: number
  imageH: number
}

/**
 * 计算与壳层 cover 裁剪对齐的 webview 背景声明（含 !important）。
 * 返回 null 表示无需对齐（几何无效时调用方回退 cover）。
 */
export function alignedWallpaperBackground(input: AlignInput): string | null {
  const { viewportW, viewportH, rect, imageW, imageH } = input
  if (viewportW <= 0 || viewportH <= 0 || imageW <= 0 || imageH <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  // 壳层 cover 缩放系数与缩放后尺寸
  const scale = Math.max(viewportW / imageW, viewportH / imageH)
  const sw = imageW * scale
  const sh = imageH * scale
  // 居中裁剪：缩放图左上角相对可见区左上角的偏移
  const ox = (sw - viewportW) / 2
  const oy = (sh - viewportH) / 2
  // webview 应显示的缩放图子区域起点（缩放图坐标系）
  const px = ox + rect.x
  const py = oy + rect.y
  const r2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '0')
  return [
    `background-size: ${r2(sw)}px ${r2(sh)}px !important;`,
    `background-position: ${r2(-px)}px ${r2(-py)}px !important;`,
    'background-repeat: no-repeat !important;'
  ].join('\n')
}
