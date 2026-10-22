// 템플릿 PNG(dataURL) ↔ 픽셀 변환.

import type { Rect, Rgba } from '../core/image'

const cache = new Map<string, Promise<Rgba>>()

export function decodePng(dataUrl: string): Promise<Rgba> {
  let p = cache.get(dataUrl)
  if (!p) {
    p = (async () => {
      const blob = await (await fetch(dataUrl)).blob()
      const bmp = await createImageBitmap(blob)
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d')!
      g.drawImage(bmp, 0, 0)
      const img = g.getImageData(0, 0, bmp.width, bmp.height)
      bmp.close()
      return { width: img.width, height: img.height, data: img.data }
    })()
    cache.set(dataUrl, p)
  }
  return p
}

export function cropToPng(source: HTMLCanvasElement, r: Rect): string {
  const c = document.createElement('canvas')
  c.width = r.w
  c.height = r.h
  c.getContext('2d')!.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c.toDataURL('image/png')
}

export function cropToRgba(source: HTMLCanvasElement, r: Rect): Rgba {
  const img = source.getContext('2d')!.getImageData(r.x, r.y, r.w, r.h)
  return { width: img.width, height: img.height, data: img.data }
}

export function rgbaToDataUrl(img: Rgba, scale = 1): string {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  if (scale === 1) return c.toDataURL()
  const big = document.createElement('canvas')
  big.width = img.width * scale
  big.height = img.height * scale
  const g = big.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(c, 0, 0, big.width, big.height)
  return big.toDataURL()
}
