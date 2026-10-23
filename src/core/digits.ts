// 버프/스킬 아이콘 위의 남은 시간 숫자를 읽는 간단한 학습형 OCR.
// 메이플 숫자는 고정 비트맵 글꼴이라, 사용자가 몇 번 알려준 글자 모양과 최근접 비교로 충분하다.

import type { Rgba } from './image'

export interface GlyphSample {
  char: string
  feat: number[]
}

/**
 * 어떤 픽셀을 글자로 볼지.
 * - yellowMin이 있으면 "노란 정도" min(R,G) - B 가 그 이상인 픽셀(메이플 남은 시간 숫자는 검은 테두리의 노란 글자).
 *   흰색·회색 아이콘 그림은 밝아도 노란 정도가 0에 가까워 섞이지 않고, JPEG처럼 색이 번져도 잘 버틴다.
 * - 없으면 밝기가 threshold 이상인 픽셀.
 */
export interface TextRule {
  threshold: number
  yellowMin?: number | null
}

export interface DigitBank extends TextRule {
  samples: GlyphSample[]
}

// 실제 스크린샷(1920x1080, 17장)의 숫자 크롭으로 평가해 가장 정확했던 값. 흐려지는(깜빡이는) 숫자도 잡도록 낮게.
export const DEFAULT_YELLOW_MIN = 30

export interface Glyph {
  x: number
  y: number
  w: number
  h: number
  bits: Uint8Array // w*h
  count: number // 글자 픽셀 수
}

const GW = 6
const GH = 10
const MAX_SAMPLES_PER_CHAR = 20

export function ruleLabel(r: TextRule): string {
  return r.yellowMin != null ? `노란 글자 (노란 정도 ${r.yellowMin} 이상)` : `밝기 ${r.threshold} 이상`
}

export function emptyBank(): DigitBank {
  return { threshold: 220, yellowMin: DEFAULT_YELLOW_MIN, samples: [] }
}

const asRule = (r: TextRule | number): TextRule => (typeof r === 'number' ? { threshold: r } : r)

export function binarize(img: Rgba, rule: TextRule | number): Uint8Array {
  const { threshold, yellowMin } = asRule(rule)
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  if (yellowMin != null) {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const m = Math.min(d[j], d[j + 1])
      out[i] = m >= 110 && m - d[j + 2] >= yellowMin ? 1 : 0
    }
    return out
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] >= threshold ? 1 : 0
  }
  return out
}

/** 세로로 빈 열을 기준으로 글자를 자른다. */
export function segment(img: Rgba, rule: TextRule | number): Glyph[] {
  const { width, height } = img
  const bin = binarize(img, rule)
  // 글자 줄(글자 픽셀이 있는 행이 이어진 가장 긴 구간)만 남긴다. 숫자 영역 위아래에 걸친 아이콘 그림의
  // 노란 부분(예: 금색 주머니)이 글자 상자를 늘려 모양을 망가뜨리는 것을 막는다.
  const rowOn = new Uint16Array(height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rowOn[y] += bin[y * width + x]
  let band = [0, -1]
  for (let y = 0; y < height; ) {
    if (!rowOn[y]) {
      y++
      continue
    }
    const y0 = y
    while (y < height && rowOn[y]) y++
    if (y - y0 > band[1] - band[0] + 1) band = [y0, y - 1]
  }
  for (let y = 0; y < height; y++) if (y < band[0] || y > band[1]) bin.fill(0, y * width, (y + 1) * width)
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
    glyphs.push({ x: x0, y: y0, w, h, bits, count })
  }

  // ':'와 잡티는 버린다. ':'는 1~2px 점 두 개라 화질에 따라 한쪽 점이 사라지기도 해서 믿을 수 없다.
  // 대신 읽은 숫자 개수로 콜론 위치를 되살린다(read 참고). 숫자 '1'도 세로획이라 픽셀 수가 충분하다.
  const maxH = Math.max(0, ...glyphs.map((g) => g.h))
  const maxCount = Math.max(0, ...glyphs.map((g) => g.count))
  return glyphs.filter((g) => g.h >= maxH * 0.5 && g.count >= maxCount * 0.3)
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
 * 글자 수가 count가 되도록 분리되는 기준을 찾는다(색 기준이면 허용 오차, 밝기 기준이면 밝기).
 * 아이콘 그림이 숫자와 붙지 않는 구간 중 가장 긴 구간의 가운데 값을 고른다.
 */
export function findRule(img: Rgba, count: number, base: TextRule): Partial<TextRule> | null {
  const color = base.yellowMin != null
  const [lo, hi, step] = color ? [15, 140, 5] : [100, 252, 4]
  const at = (v: number): TextRule => (color ? { ...base, yellowMin: v } : { ...base, threshold: v })
  let best: [number, number] | null = null
  let run: [number, number] | null = null
  for (let v = lo; v <= hi; v += step) {
    if (segment(img, at(v)).length === count) {
      run = run ? [run[0], v] : [v, v]
      if (!best || run[1] - run[0] > best[1] - best[0]) best = [...run]
    } else run = null
  }
  if (!best) return null
  const v = Math.round((best[0] + best[1]) / 2)
  return color ? { yellowMin: v } : { threshold: v }
}

/** 학습/비교에 쓰는 문자: 숫자만(콜론은 위치로 복원하므로 제외). */
const digitsOf = (text: string) => [...text.replace(/[^0-9]/g, '')]

/**
 * text에 보이는 문자열(예: "2:43")을 알려주면 숫자별 표본을 저장한다(콜론은 무시).
 * 아직 학습한 글자가 없으면 글자 판정 기준도 자동으로 맞춘다.
 */
export function learn(bank: DigitBank, img: Rgba, text: string): LearnResult {
  const chars = digitsOf(text)
  if (!chars.length) return { ok: false, glyphCount: 0, expected: 0 }
  if (!bank.samples.length && segment(img, bank).length !== chars.length) {
    const r = findRule(img, chars.length, bank)
    if (r) Object.assign(bank, r)
  }
  const glyphs = segment(img, bank)
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

// 실제 화면에서 맞는 글자의 거리 90%가 0.44 이하. 한 번 잘못 읽어도 추적기가 연속 두 번 일치해야 받아들인다.
export const MAX_GLYPH_DISTANCE = 0.5

export function read(bank: DigitBank, img: Rgba): ReadResult | null {
  const samples = bank.samples.filter((s) => /^[0-9]$/.test(s.char))
  if (!samples.length) return null
  const glyphs = segment(img, bank)
  if (!glyphs.length) return null
  const lh = Math.max(...glyphs.map((g) => g.h))
  let digits = ''
  let worst = 0
  for (const g of glyphs) {
    const f = features(g, lh)
    let best = Infinity
    let ch = '?'
    for (const s of samples) {
      const d = distance(f, s.feat)
      if (d < best) {
        best = d
        ch = s.char
      }
    }
    if (best > MAX_GLYPH_DISTANCE) ch = '?'
    worst = Math.max(worst, best)
    digits += ch
  }
  // 아이콘 숫자는 1분 이상이면 m:ss(3자리 이상), 미만이면 ss — 숫자 개수로 콜론 위치를 정한다.
  const text = digits.length >= 3 ? `${digits.slice(0, -2)}:${digits.slice(-2)}` : digits
  return { text, worst }
}

export function learnedChars(bank: DigitBank): string[] {
  return [...new Set(bank.samples.map((s) => s.char))].filter((c) => /^[0-9]$/.test(c)).sort()
}
