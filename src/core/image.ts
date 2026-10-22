// 프레임/템플릿 공용 이미지 유틸. DOM 없이 동작해야 워커와 테스트에서 함께 쓸 수 있다.

export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA
}

export interface Gray {
  width: number
  height: number
  data: Float32Array // 0..255
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function makeRgba(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function cropRgba(src: Rgba, r: Rect): Rgba {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(src.width, Math.floor(r.x + r.w))
  const y1 = Math.min(src.height, Math.floor(r.y + r.h))
  const w = Math.max(0, x1 - x0)
  const h = Math.max(0, y1 - y0)
  const out = makeRgba(w, h)
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * src.width + x0) * 4
    out.data.set(src.data.subarray(s, s + w * 4), y * w * 4)
  }
  return out
}

export function toGray(src: Rgba): Gray {
  const n = src.width * src.height
  const out = new Float32Array(n)
  const d = src.data
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  }
  return { width: src.width, height: src.height, data: out }
}

/** 채널별 평면(R,G,B)으로 분리. 컬러 NCC에 쓴다. */
export function toPlanes(src: Rgba): Gray[] {
  const n = src.width * src.height
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const d = src.data
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    planes[0][i] = d[j]
    planes[1][i] = d[j + 1]
    planes[2][i] = d[j + 2]
  }
  return planes.map((data) => ({ width: src.width, height: src.height, data }))
}

/** 정수 배율 박스 평균 축소. */
export function downscale(src: Gray, s: number): Gray {
  if (s <= 1) return src
  const w = Math.floor(src.width / s)
  const h = Math.floor(src.height / s)
  const out = new Float32Array(w * h)
  const inv = 1 / (s * s)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < s; dy++) {
        const row = (y * s + dy) * src.width + x * s
        for (let dx = 0; dx < s; dx++) sum += src.data[row + dx]
      }
      out[y * w + x] = sum * inv
    }
  }
  return { width: w, height: h, data: out }
}

/** 마스크도 같은 방식으로 축소한다. 셀의 절반 이상이 유효하면 유효로 본다. */
export function downscaleMask(mask: Uint8Array, width: number, height: number, s: number): Uint8Array {
  if (s <= 1) return mask
  const w = Math.floor(width / s)
  const h = Math.floor(height / s)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) on += mask[(y * s + dy) * width + x * s + dx]
      }
      out[y * w + x] = on * 2 >= s * s ? 1 : 0
    }
  }
  return out
}

/** 비율(0..1) 영역을 픽셀 영역으로 변환. */
export function fracToRect(frac: Rect, width: number, height: number): Rect {
  const x = Math.round(frac.x * width)
  const y = Math.round(frac.y * height)
  return {
    x,
    y,
    w: Math.min(width - x, Math.round(frac.w * width)),
    h: Math.min(height - y, Math.round(frac.h * height)),
  }
}
