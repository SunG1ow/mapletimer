// 마스크 지원 정규화 상호상관(NCC) 템플릿 매칭.
// 1) 회색조로 축소한 영상에서 후보를 찾고 2) 원본 해상도 컬러 NCC로 정밀 위치/점수를 구한다.

import { downscale, downscaleMask, toGray, toPlanes, type Gray, type Rect, type Rgba } from './image'

export interface PreparedTemplate {
  width: number
  height: number
  planes: Gray[]
  mask: Uint8Array // 1 = 비교에 사용
  coarseScale: number
  coarseGray: Gray
  coarseMask: Uint8Array
}

export interface MatchResult {
  x: number
  y: number
  score: number
}

/** exclude: 템플릿 내부에서 비교하지 않을 영역(예: 계속 바뀌는 숫자). */
export function prepareTemplate(rgba: Rgba, exclude?: Rect | null): PreparedTemplate {
  const { width, height } = rgba
  const mask = new Uint8Array(width * height).fill(1)
  if (exclude) {
    for (let y = Math.max(0, exclude.y); y < Math.min(height, exclude.y + exclude.h); y++) {
      for (let x = Math.max(0, exclude.x); x < Math.min(width, exclude.x + exclude.w); x++) {
        mask[y * width + x] = 0
      }
    }
  }
  // 축소 후에도 한 변이 최소 6px 남도록 배율을 고른다.
  const coarseScale = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 6)))
  return {
    width,
    height,
    planes: toPlanes(rgba),
    mask,
    coarseScale,
    coarseGray: downscale(toGray(rgba), coarseScale),
    coarseMask: downscaleMask(mask, width, height, coarseScale),
  }
}

interface ZeroMeanTemplate {
  offsetsT: Int32Array // 템플릿 내부 인덱스
  values: Float32Array // 평균을 뺀 값
  sumSq: number
  n: number
}

function zeroMean(t: Gray, mask: Uint8Array): ZeroMeanTemplate {
  const idx: number[] = []
  let sum = 0
  for (let i = 0; i < t.data.length; i++) {
    if (mask[i]) {
      idx.push(i)
      sum += t.data[i]
    }
  }
  const n = idx.length
  const mean = n ? sum / n : 0
  const values = new Float32Array(n)
  let sumSq = 0
  for (let k = 0; k < n; k++) {
    const v = t.data[idx[k]] - mean
    values[k] = v
    sumSq += v * v
  }
  return { offsetsT: Int32Array.from(idx), values, sumSq, n }
}

function imageOffsets(zt: ZeroMeanTemplate, tWidth: number, imgWidth: number): Int32Array {
  const out = new Int32Array(zt.n)
  for (let k = 0; k < zt.n; k++) {
    const ti = zt.offsetsT[k]
    out[k] = Math.floor(ti / tWidth) * imgWidth + (ti % tWidth)
  }
  return out
}

function nccAt(img: Float32Array, base: number, offs: Int32Array, zt: ZeroMeanTemplate): number {
  let sI = 0
  let sI2 = 0
  let sIT = 0
  const v = zt.values
  for (let k = 0; k < offs.length; k++) {
    const p = img[base + offs[k]]
    sI += p
    sI2 += p * p
    sIT += p * v[k]
  }
  const varI = sI2 - (sI * sI) / zt.n
  // 템플릿이나 영상 조각이 단색이면 상관을 정의할 수 없다.
  if (varI < 1e-3 || zt.sumSq < 1e-3) return 0
  return sIT / Math.sqrt(varI * zt.sumSq)
}

const cache = new WeakMap<PreparedTemplate, { coarse: ZeroMeanTemplate; planes: ZeroMeanTemplate[] }>()

function zeroMeans(t: PreparedTemplate) {
  let z = cache.get(t)
  if (!z) {
    z = {
      coarse: zeroMean(t.coarseGray, t.coarseMask),
      planes: t.planes.map((p) => zeroMean(p, t.mask)),
    }
    cache.set(t, z)
  }
  return z
}

/** 원본 해상도 컬러 NCC (채널 평균). */
export function colorScore(planes: Gray[], t: PreparedTemplate, x: number, y: number): number {
  if (x < 0 || y < 0 || x + t.width > planes[0].width || y + t.height > planes[0].height) return -1
  const z = zeroMeans(t)
  let total = 0
  let used = 0
  for (let c = 0; c < 3; c++) {
    const zt = z.planes[c]
    if (zt.sumSq < 1e-3) continue // 이 채널은 정보가 없다(예: 회색 아이콘의 동일 채널)
    const offs = imageOffsets(zt, t.width, planes[c].width)
    total += nccAt(planes[c].data, y * planes[c].width + x, offs, zt)
    used++
  }
  return used ? total / used : 0
}

/**
 * region(이미 잘라낸 탐색 영역) 안에서 템플릿의 최적 위치를 찾는다.
 * 반환 좌표는 region 기준.
 */
export function findTemplate(region: Rgba, t: PreparedTemplate, topK = 5): MatchResult | null {
  if (region.width < t.width || region.height < t.height) return null
  const s = t.coarseScale
  const z = zeroMeans(t)
  const gray = downscale(toGray(region), s)
  const tw = t.coarseGray.width
  const th = t.coarseGray.height
  const mw = gray.width - tw + 1
  const mh = gray.height - th + 1
  if (mw <= 0 || mh <= 0) return null

  const offs = imageOffsets(z.coarse, tw, gray.width)
  const scores = new Float32Array(mw * mh)
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      scores[y * mw + x] = nccAt(gray.data, y * gray.width + x, offs, z.coarse)
    }
  }

  // 상위 후보를 비최대 억제로 고른다.
  const candidates: { x: number; y: number }[] = []
  const rx = Math.max(1, Math.floor(tw / 2))
  const ry = Math.max(1, Math.floor(th / 2))
  for (let k = 0; k < topK; k++) {
    let best = -Infinity
    let bi = -1
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > best) {
        best = scores[i]
        bi = i
      }
    }
    if (bi < 0 || best <= 0.2) break
    const cx = bi % mw
    const cy = Math.floor(bi / mw)
    candidates.push({ x: cx, y: cy })
    for (let y = Math.max(0, cy - ry); y <= Math.min(mh - 1, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x <= Math.min(mw - 1, cx + rx); x++) scores[y * mw + x] = -Infinity
    }
  }
  if (!candidates.length) return null

  const planes = toPlanes(region)
  let best: MatchResult | null = null
  const r = s + 1
  for (const c of candidates) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = c.x * s + dx
        const y = c.y * s + dy
        const score = colorScore(planes, t, x, y)
        if (!best || score > best.score) best = { x, y, score }
      }
    }
  }
  return best
}

// ---- 룬용: 배경 무시 + 가림 허용 매칭 ----
// 미니맵 배경은 맵마다 다르고, 플레이어 점(노랑/빨강/하늘색 원)이 룬 일부를 가릴 수 있다.
// 그래서 상관계수 대신 "룬 모양 픽셀 중 색이 맞는 비율"을 점수로 쓴다.

/** 가장자리 픽셀의 중앙값 색을 배경으로 보고, 그와 tol 이상 다른 픽셀을 전경(1)으로 표시한다. */
export function foregroundMask(img: Rgba, tol: number): Uint8Array {
  const { width: w, height: h, data } = img
  const border: number[][] = [[], [], []]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) border[c].push(data[i + c])
    }
  }
  const med = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1])
  const mask = new Uint8Array(w * h)
  let on = 0
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(
      Math.abs(data[i * 4] - med[0]),
      Math.abs(data[i * 4 + 1] - med[1]),
      Math.abs(data[i * 4 + 2] - med[2]),
    )
    if (d >= tol) {
      mask[i] = 1
      on++
    }
  }
  // 전경이 거의 없으면 마스크가 의미 없으니 전체 비교로 돌아간다.
  if (on < 5) return mask.fill(1)
  // 룬은 발판 위에 뜨므로 1px 발판 선이 같이 잘린다. 열림 연산(침식→팽창)으로 얇은 선을 걷어낸다.
  const opened = morph(morph(mask, w, h, 'erode'), w, h, 'dilate')
  for (let i = 0; i < opened.length; i++) opened[i] &= mask[i]
  return opened.reduce((a, b) => a + b, 0) >= 5 ? opened : mask
}

function morph(m: Uint8Array, w: number, h: number, op: 'erode' | 'dilate'): Uint8Array {
  const out = new Uint8Array(m.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = op === 'erode' ? 1 : 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          const p = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m[yy * w + xx]
          if (op === 'erode') v &= p
          else v |= p
        }
      }
      out[y * w + x] = v
    }
  }
  return out
}

export interface PreparedShape {
  width: number
  height: number
  idx: Int32Array // 템플릿 내 전경 픽셀 인덱스
  rgb: Uint8Array // 전경 픽셀 색 (r,g,b 반복)
}

export function prepareShape(img: Rgba, mask: Uint8Array): PreparedShape {
  const idx: number[] = []
  const rgb: number[] = []
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    idx.push(i)
    rgb.push(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
  }
  return { width: img.width, height: img.height, idx: Int32Array.from(idx), rgb: Uint8Array.from(rgb) }
}

const COLOR_TOL = 48

/** 미니맵 플레이어 점 색: 노랑(본인), 빨강(다른 사람), 하늘색(길드원), 초록(파티) */
export const PLAYER_DOT_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 230, 0],
  [255, 40, 40],
  [80, 220, 255],
  [60, 230, 60],
]
const DOT_TOL = 70

function nearDot(r: number, g: number, b: number): boolean {
  for (const c of PLAYER_DOT_COLORS) {
    if (Math.abs(r - c[0]) <= DOT_TOL && Math.abs(g - c[1]) <= DOT_TOL && Math.abs(b - c[2]) <= DOT_TOL) return true
  }
  return false
}

/**
 * 플레이어 점에 가려진 픽셀은 판단에서 빼고 "보이는 부분 중 맞는 비율"을 낸다.
 * 다만 절반 넘게 가려지면 근거가 부족하니 보이는 비율만큼 깎는다.
 */
function fractionAt(region: Rgba, offs: Int32Array, s: PreparedShape, base: number): number {
  const d = region.data
  const n = offs.length
  let hit = 0
  let hidden = 0
  for (let k = 0; k < n; k++) {
    const p = (base + offs[k]) * 4
    const q = k * 3
    if (
      Math.abs(d[p] - s.rgb[q]) <= COLOR_TOL &&
      Math.abs(d[p + 1] - s.rgb[q + 1]) <= COLOR_TOL &&
      Math.abs(d[p + 2] - s.rgb[q + 2]) <= COLOR_TOL
    )
      hit++
    else if (nearDot(d[p], d[p + 1], d[p + 2])) hidden++
    // 남은 픽셀이 모두 맞아도 30%를 못 넘으면 중단
    else if ((k & 7) === 7 && hit + hidden + (n - k) < n * 0.3) return 0
  }
  const visible = n - hidden
  if (visible <= 0) return 0
  return (hit / visible) * Math.min(1, visible / (n * 0.5))
}

/** 점수 = 전경 픽셀 중 색이 맞는 비율(0..1). 2px 간격으로 훑고 상위 후보 주변을 정밀 탐색. */
export function findShape(region: Rgba, s: PreparedShape): MatchResult | null {
  const mw = region.width - s.width + 1
  const mh = region.height - s.height + 1
  if (mw <= 0 || mh <= 0 || !s.idx.length) return null
  const offs = new Int32Array(s.idx.length)
  for (let k = 0; k < s.idx.length; k++) {
    const ti = s.idx[k]
    offs[k] = Math.floor(ti / s.width) * region.width + (ti % s.width)
  }
  const top: MatchResult[] = []
  for (let y = 0; y < mh; y += 2) {
    for (let x = 0; x < mw; x += 2) {
      const score = fractionAt(region, offs, s, y * region.width + x)
      if (score <= 0.3) continue
      if (top.length < 5 || score > top[top.length - 1].score) {
        top.push({ x, y, score })
        top.sort((a, b) => b.score - a.score)
        if (top.length > 5) top.pop()
      }
    }
  }
  let best: MatchResult | null = null
  for (const c of top) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx
        const y = c.y + dy
        if (x < 0 || y < 0 || x >= mw || y >= mh) continue
        const score = fractionAt(region, offs, s, y * region.width + x)
        if (!best || score > best.score) best = { x, y, score }
      }
    }
  }
  return best
}
