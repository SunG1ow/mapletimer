// 테스트용 합성 이미지 도구.
import { makeRgba, type Rgba } from '../image'

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function noise(w: number, h: number, seed = 1, max = 120): Rgba {
  const r = rng(seed)
  const img = makeRgba(w, h)
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = r() * max
    img.data[i * 4 + 1] = r() * max
    img.data[i * 4 + 2] = r() * max
    img.data[i * 4 + 3] = 255
  }
  return img
}

export function paste(dst: Rgba, src: Rgba, x: number, y: number) {
  for (let yy = 0; yy < src.height; yy++) {
    for (let xx = 0; xx < src.width; xx++) {
      const s = (yy * src.width + xx) * 4
      const d = ((y + yy) * dst.width + x + xx) * 4
      dst.data.set(src.data.subarray(s, s + 4), d)
    }
  }
}

/** 원·줄무늬가 있는 가짜 아이콘. */
export function icon(size: number, hue: number): Rgba {
  const img = makeRgba(size, size)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const ring = d < size * 0.4 ? 1 : 0
      img.data[i] = (hue * 50 + ring * 150 + ((x + y) % 5) * 10) % 256
      img.data[i + 1] = (ring ? 200 : 40) - (y * 3) % 60
      img.data[i + 2] = (hue * 90 + x * 4) % 256
      img.data[i + 3] = 255
    }
  }
  return img
}

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
}

/** 어두운 배경에 밝은 글자를 scale 배로 그린다. 글자 사이 1칸 띄움. */
export function text(str: string, scale = 2, bg?: Rgba): Rgba {
  const cols = [...str].reduce((n, ch) => n + FONT[ch][0].length + 1, 1)
  const w = cols * scale
  const h = 7 * scale
  const img = bg ?? noise(w, h, 7, 90)
  let cx = 1
  for (const ch of str) {
    const g = FONT[ch]
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < g[0].length; gx++) {
        if (g[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const i = (((gy + 1) * scale + sy) * img.width + (cx + gx) * scale + sx) * 4
            img.data[i] = 255
            img.data[i + 1] = 230
            img.data[i + 2] = 120
          }
        }
      }
    }
    cx += g[0].length + 1
  }
  return img
}
