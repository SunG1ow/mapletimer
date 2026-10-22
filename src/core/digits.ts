// 버프/스킬 아이콘 위의 남은 시간 숫자를 읽는 간단한 학습형 OCR.
// 메이플 숫자는 고정 비트맵 글꼴이라, 사용자가 몇 번 알려준 글자 모양과 최근접 비교로 충분하다.

import type { Rgba } from './image'

export interface GlyphSample {
  char: string
  feat: number[]
}

export interface DigitBank {
  threshold: number // 이 밝기 이상을 글자 픽셀로 본다
  samples: GlyphSample[]
}

export interface Glyph {
  x: number
  y: number
  w: number
  h: number
  bits: Uint8Array // w*h
}

const GW = 6
const GH = 10
const MAX_SAMPLES_PER_CHAR = 8

export function emptyBank(): DigitBank {
  return { threshold: 220, samples: [] }
}

export function binarize(img: Rgba, threshold: number): Uint8Array {
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] >= threshold ? 1 : 0
  }
  return out
}

/** 세로로 빈 열을 기준으로 글자를 자른다. */
export function segment(img: Rgba, threshold: number): Glyph[] {
  const { width, height } = img
  const bin = binarize(img, threshold)
  const colOn = new Uint16Array(width)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) colOn[x] += bin[y * width + x]

  const glyphs: Glyph[] = []
  let x = 0
  while (x < width) {
    if (!colOn[x]) {
      x++
      continue
    }
    const x0 = x
    let count = 0
    while (x < width && colOn[x]) count += colOn[x++]
    const x1 = x
    if (count < 3) continue // 잡티
    let y0 = height
    let y1 = -1
    for (let yy = 0; yy < height; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        if (bin[yy * width + xx]) {
          if (yy < y0) y0 = yy
          if (yy > y1) y1 = yy
          break
        }
      }
    }
    const w = x1 - x0
    const h = y1 - y0 + 1
    const bits = new Uint8Array(w * h)
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) bits[yy * w + xx] = bin[(y0 + yy) * width + x0 + xx]
    glyphs.push({ x: x0, y: y0, w, h, bits })
  }

  // 가장 큰 글자 높이의 35% 미만인 조각은 아이콘 그림의 잡티로 보고 버린다. (':'는 두 점이 한 덩어리라 충분히 크다)
  const maxH = Math.max(0, ...glyphs.map((g) => g.h))
  return glyphs.filter((g) => g.h >= maxH * 0.35)
}

/** 글자를 고정 크기 격자로 정규화한 특징 벡터. 마지막 두 값은 모양 비율과 줄 안에서의 높이. */
export function features(g: Glyph, lineHeight: number): number[] {
  const f: number[] = []
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const sx0 = Math.floor((gx * g.w) / GW)
      const sx1 = Math.max(sx0 + 1, Math.floor(((gx + 1) * g.w) / GW))
      const sy0 = Math.floor((gy * g.h) / GH)
      const sy1 = Math.max(sy0 + 1, Math.floor(((gy + 1) * g.h) / GH))
      let on = 0
      let tot = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          on += g.bits[y * g.w + x]
          tot++
        }
      }
      f.push(tot ? on / tot : 0)
    }
  }
  f.push((g.w / g.h) * 2)
  f.push((g.h / Math.max(1, lineHeight)) * 2)
  return f
}

function distance(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    s += d * d
  }
  return Math.sqrt(s / a.length)
}

export interface LearnResult {
  ok: boolean
  glyphCount: number
  expected: number
}

/**
 * 글자 수가 count가 되도록 분리되는 밝기 기준을 찾는다. 아이콘 그림의 밝은 부분이 숫자와 붙지 않는
 * 구간 중 가장 긴 구간의 가운데 값을 고른다.
 */
export function findThreshold(img: Rgba, count: number): number | null {
  let best: [number, number] | null = null
  let run: [number, number] | null = null
  for (let t = 100; t <= 252; t += 4) {
    if (segment(img, t).length === count) {
      run = run ? [run[0], t] : [t, t]
      if (!best || run[1] - run[0] > best[1] - best[0]) best = [...run]
    } else run = null
  }
  return best ? Math.round((best[0] + best[1]) / 2) : null
}

/**
 * text에 보이는 문자열(예: "2:43")을 알려주면 글자별 표본을 저장한다.
 * 아직 학습한 글자가 없으면 밝기 기준도 자동으로 맞춘다.
 */
export function learn(bank: DigitBank, img: Rgba, text: string): LearnResult {
  const chars = [...text.replace(/\s+/g, '')]
  if (!bank.samples.length && segment(img, bank.threshold).length !== chars.length) {
    const t = findThreshold(img, chars.length)
    if (t !== null) bank.threshold = t
  }
  const glyphs = segment(img, bank.threshold)
  if (glyphs.length !== chars.length) return { ok: false, glyphCount: glyphs.length, expected: chars.length }
  const lh = Math.max(...glyphs.map((g) => g.h))
  glyphs.forEach((g, i) => {
    bank.samples.push({ char: chars[i], feat: features(g, lh) })
    const same = bank.samples.filter((s) => s.char === chars[i])
    if (same.length > MAX_SAMPLES_PER_CHAR) bank.samples.splice(bank.samples.indexOf(same[0]), 1)
  })
  return { ok: true, glyphCount: glyphs.length, expected: chars.length }
}

export interface ReadResult {
  text: string
  worst: number // 가장 자신 없는 글자의 거리(작을수록 확실)
}

export const MAX_GLYPH_DISTANCE = 0.28

export function read(bank: DigitBank, img: Rgba): ReadResult | null {
  if (!bank.samples.length) return null
  const glyphs = segment(img, bank.threshold)
  if (!glyphs.length) return null
  const lh = Math.max(...glyphs.map((g) => g.h))
  let text = ''
  let worst = 0
  for (const g of glyphs) {
    const f = features(g, lh)
    let best = Infinity
    let ch = '?'
    for (const s of bank.samples) {
      const d = distance(f, s.feat)
      if (d < best) {
        best = d
        ch = s.char
      }
    }
    if (best > MAX_GLYPH_DISTANCE) ch = '?'
    worst = Math.max(worst, best)
    text += ch
  }
  return { text, worst }
}

export function learnedChars(bank: DigitBank): string[] {
  return [...new Set(bank.samples.map((s) => s.char))].sort()
}
