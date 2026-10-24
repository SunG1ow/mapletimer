// 마스크 지원 정규화 상호상관(NCC) 템플릿 매칭.
// 1) 회색조로 축소한 영상에서 후보를 찾고 2) 원본 해상도 컬러 NCC로 정밀 위치/점수를 구한다.

import { downscale, downscaleMask, toGray, toPlanes, type Gray, type Rect, type Rgba } from './image'

/** 축소 탐색용 템플릿. 화면 위 위치가 축소 배율의 배수가 아니면 묶는 경계가 어긋나므로, 시작점을 밀어 둔 판을 모두 둔다. */
export interface CoarsePhase {
  px: number
  py: number
  gray: Gray
  mask: Uint8Array
  /** 마스크가 "전체 사각형 - 빼는 사각형 하나"면 그 빼는 사각형(없으면 null). 적분 영상으로 빠르게 계산한다. */
  hole: Rect | null | undefined
}

/** 마스크의 0인 부분이 사각형 하나면 그 사각형, 0이 없으면 null, 그 밖의 모양이면 undefined(빠른 계산 불가). */
function maskHole(mask: Uint8Array, w: number, h: number): Rect | null | undefined {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) return undefined
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export interface PreparedTemplate {
  width: number
  height: number
  planes: Gray[]
  mask: Uint8Array // 1 = 비교에 사용
  coarseScale: number
  coarse: CoarsePhase[]
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
  // 축소 탐색 배율. 이펙트가 많은 사냥 화면에서는 4배 축소하면 진짜 위치가 후보에서 빠지는 일이 있어
  // (실제 스크린샷으로 확인) 최대 2배로 제한한다.
  const coarseScale = Math.max(1, Math.min(2, Math.floor(Math.min(width, height) / 6)))
  // 2배 축소 시 아이콘이 홀수 좌표에 있으면 반 칸 어긋나 축소 점수가 크게 떨어진다(VIP 아이콘 실측 0.42).
  // 시작점을 0~(배율-1)만큼 민 판을 모두 만들어 어느 좌표든 한 판은 경계가 맞게 한다.
  const gray = toGray(rgba)
  const coarse: CoarsePhase[] = []
  for (let py = 0; py < coarseScale; py++) {
    for (let px = 0; px < coarseScale; px++) {
      const w = width - px
      const h = height - py
      const g = new Float32Array(w * h)
      const m = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          g[y * w + x] = gray.data[(y + py) * width + x + px]
          m[y * w + x] = mask[(y + py) * width + x + px]
        }
      }
      const cg = downscale({ width: w, height: h, data: g }, coarseScale)
      const cm = downscaleMask(m, w, h, coarseScale)
      coarse.push({ px, py, gray: cg, mask: cm, hole: maskHole(cm, cg.width, cg.height) })
    }
  }
  return { width, height, planes: toPlanes(rgba), mask, coarseScale, coarse }
}

/**
 * 축소 탐색 위치가 이보다 많으면(화면 전체 등) 첫 판(시작점 0)만 전체를 보고 후보를 고른 뒤,
 * 나머지 판은 그 후보 주변만 본다. 네 판을 전체에 다 돌리면 화면 전체에서 실측 1.2초.
 * 첫 판에서 반 칸 어긋난 아이콘도 점수가 크게 떨어질 뿐 상위 수백 안에는 든다(VIP 실측 19위).
 */
const PRE_FILTER_POSITIONS = 40_000
const PRE_KEEP = 600

interface ZeroMeanTemplate {
  offsetsT: Int32Array // 템플릿 내부 인덱스
  values: Float32Array // 평균을 뺀 값
  sumSq: number
  n: number
  offsCache: Map<number, Int32Array> // 영상 폭 → 영상 인덱스 오프셋
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
  return { offsetsT: Int32Array.from(idx), values, sumSq, n, offsCache: new Map() }
}

function imageOffsets(zt: ZeroMeanTemplate, tWidth: number, imgWidth: number): Int32Array {
  const cached = zt.offsCache.get(imgWidth)
  if (cached) return cached
  const out = new Int32Array(zt.n)
  for (let k = 0; k < zt.n; k++) {
    const ti = zt.offsetsT[k]
    out[k] = Math.floor(ti / tWidth) * imgWidth + (ti % tWidth)
  }
  zt.offsCache.set(imgWidth, out)
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

const cache = new WeakMap<
  PreparedTemplate,
  { coarse: ZeroMeanTemplate[]; planes: ZeroMeanTemplate[] }
>()

function zeroMeans(t: PreparedTemplate) {
  let z = cache.get(t)
  if (!z) {
    z = {
      coarse: t.coarse.map((c) => zeroMean(c.gray, c.mask)),
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

/** 탐색 영역 하나의 회색조/채널 데이터. 같은 영역을 보는 여러 템플릿이 한 프레임 안에서 공유한다. */
export class SearchRegion {
  readonly rgba: Rgba
  private grays = new Map<number, Gray>()
  private planesCache: Gray[] | null = null

  constructor(rgba: Rgba) {
    this.rgba = rgba
  }

  gray(scale: number): Gray {
    let g = this.grays.get(scale)
    if (!g) {
      let base = this.grays.get(1)
      if (!base) {
        base = toGray(this.rgba)
        this.grays.set(1, base)
      }
      g = downscale(base, scale)
      this.grays.set(scale, g)
    }
    return g
  }

  planes(): Gray[] {
    return (this.planesCache ??= toPlanes(this.rgba))
  }

  private integrals = new Map<number, { s: Float64Array; s2: Float64Array }>()

  /** 축소 영상의 누적합(값, 제곱). 사각형 합을 덧셈 4번으로 구한다. */
  integral(scale: number) {
    let r = this.integrals.get(scale)
    if (!r) {
      const g = this.gray(scale)
      const W = g.width + 1
      const sum = new Float64Array(W * (g.height + 1))
      const sum2 = new Float64Array(W * (g.height + 1))
      for (let y = 0; y < g.height; y++) {
        let row = 0
        let row2 = 0
        for (let x = 0; x < g.width; x++) {
          const v = g.data[y * g.width + x]
          row += v
          row2 += v * v
          sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
          sum2[(y + 1) * W + x + 1] = sum2[y * W + x + 1] + row2
        }
      }
      r = { s: sum, s2: sum2 }
      this.integrals.set(scale, r)
    }
    return r
  }
}

function rectSum(I: Float64Array, W: number, x: number, y: number, w: number, h: number): number {
  return I[(y + h) * W + x + w] - I[y * W + x + w] - I[(y + h) * W + x] + I[y * W + x]
}

/**
 * region(이미 잘라낸 탐색 영역) 안에서 템플릿의 최적 위치를 찾는다.
 * 반환 좌표는 region 기준.
 */
/** 축소 영상 위 (x,y)에서 한 판의 NCC를 계산하는 함수. 마스크가 사각형 구멍이면 누적합으로 빠르게. */
function scorer(region: SearchRegion, scale: number, phase: CoarsePhase, zt: ZeroMeanTemplate) {
  const gray = region.gray(scale)
  const tw = phase.gray.width
  const th = phase.gray.height
  const offs = imageOffsets(zt, tw, gray.width)
  const hole = phase.hole
  if (hole === undefined || zt.sumSq < 1e-3) return (x: number, y: number) => nccAt(gray.data, y * gray.width + x, offs, zt)
  const { s: S, s2: S2 } = region.integral(scale)
  const W = gray.width + 1
  const v = zt.values
  const n = zt.n
  return (x: number, y: number) => {
    let sI = rectSum(S, W, x, y, tw, th)
    let sI2 = rectSum(S2, W, x, y, tw, th)
    if (hole) {
      sI -= rectSum(S, W, x + hole.x, y + hole.y, hole.w, hole.h)
      sI2 -= rectSum(S2, W, x + hole.x, y + hole.y, hole.w, hole.h)
    }
    const varI = sI2 - (sI * sI) / n
    if (varI < 1e-3) return 0
    const base = y * gray.width + x
    let sIT = 0
    for (let k = 0; k < offs.length; k++) sIT += gray.data[base + offs[k]] * v[k]
    return sIT / Math.sqrt(varI * zt.sumSq)
  }
}

/** 점수 지도에서 thr 넘는 지역 최댓값 위치를 점수 높은 순으로. */
function localMaxima(scores: Float32Array, mw: number, mh: number, thr: number): number[] {
  const out: number[] = []
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x
      const v = scores[i]
      if (v <= thr) continue
      let isMax = true
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= mh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if ((dx || dy) && xx >= 0 && xx < mw && scores[yy * mw + xx] > v) {
            isMax = false
            break
          }
        }
      }
      if (isMax) out.push(i)
    }
  }
  return out.sort((a, b) => scores[b] - scores[a])
}

/**
 * region(이미 잘라낸 탐색 영역) 안에서 템플릿의 최적 위치를 찾는다. 반환 좌표는 region 기준.
 * 단계: (넓으면) 4배 축소로 후보 위치 거르기 → 2배 축소 + 시작점 민 판들로 후보 → 원본 컬러 NCC로 정밀.
 */
export function findTemplate(input: Rgba | SearchRegion, t: PreparedTemplate, topK = 60): MatchResult | null {
  const region = input instanceof SearchRegion ? input : new SearchRegion(input)
  if (region.rgba.width < t.width || region.rgba.height < t.height) return null
  const s = t.coarseScale
  const z = zeroMeans(t)
  const gray = region.gray(s)

  const peaks: MatchResult[] = []
  const toFull = (phase: CoarsePhase, x: number, y: number) => ({ x: x * s - phase.px, y: y * s - phase.py })
  const fullMap = (pi: number) => {
    const phase = t.coarse[pi]
    const mw = gray.width - phase.gray.width + 1
    const mh = gray.height - phase.gray.height + 1
    if (mw <= 0 || mh <= 0) return null
    const score = scorer(region, s, phase, z.coarse[pi])
    const map = new Float32Array(mw * mh)
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) map[y * mw + x] = score(x, y)
    return { map, mw, mh }
  }

  const first = fullMap(0)
  if (!first) return null
  const positions = first.mw * first.mh
  if (positions > PRE_FILTER_POSITIONS && t.coarse.length > 1) {
    // 첫 판으로 후보를 고르고, 나머지 판은 후보 주변(±1칸)만 본다.
    const seeds = localMaxima(first.map, first.mw, first.mh, 0.1).slice(0, PRE_KEEP)
    for (const i of seeds) {
      if (first.map[i] > 0.2) peaks.push({ ...toFull(t.coarse[0], i % first.mw, Math.floor(i / first.mw)), score: first.map[i] })
    }
    for (let pi = 1; pi < t.coarse.length; pi++) {
      const phase = t.coarse[pi]
      const mw = gray.width - phase.gray.width + 1
      const mh = gray.height - phase.gray.height + 1
      const score = scorer(region, s, phase, z.coarse[pi])
      for (const i of seeds) {
        const cx = i % first.mw
        const cy = Math.floor(i / first.mw)
        let bestV = -Infinity
        let bx = 0
        let by = 0
        for (let y = Math.max(0, cy - 1); y <= Math.min(mh - 1, cy + 1); y++) {
          for (let x = Math.max(0, cx - 1); x <= Math.min(mw - 1, cx + 1); x++) {
            const v = score(x, y)
            if (v > bestV) {
              bestV = v
              bx = x
              by = y
            }
          }
        }
        if (bestV > 0.2) peaks.push({ ...toFull(phase, bx, by), score: bestV })
      }
    }
  } else {
    t.coarse.forEach((phase, pi) => {
      const m = pi === 0 ? first : fullMap(pi)
      if (!m) return
      for (const i of localMaxima(m.map, m.mw, m.mh, 0.2)) peaks.push({ ...toFull(phase, i % m.mw, Math.floor(i / m.mw)), score: m.map[i] })
    })
  }
  peaks.sort((a, b) => b.score - a.score)

  // 가까운 봉우리는 하나로 친다. 너무 넓게 지우면 진짜 위치 바로 옆의 더 강한 가짜 봉우리가 진짜를 지운다.
  const rx = Math.max(1, Math.floor(t.width / 4))
  const ry = Math.max(1, Math.floor(t.height / 4))
  const candidates: { x: number; y: number }[] = []
  for (const p of peaks) {
    if (candidates.some((c) => Math.abs(c.x - p.x) <= rx && Math.abs(c.y - p.y) <= ry)) continue
    candidates.push(p)
    if (candidates.length >= topK) break
  }
  if (!candidates.length) return null

  const planes = region.planes()
  let best: MatchResult | null = null
  const r = s + 1
  for (const c of candidates) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = c.x + dx
        const y = c.y + dy
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

// 템플릿을 JPG 스크린샷에서 만들면 실제 화면보다 색이 최대 ~57 어둡게 저장된다(실측). 미니맵 안에서만 찾으므로 넉넉하게.
const COLOR_TOL = 72

/**
 * 미니맵 플레이어 점 색(실제 게임 화면에서 측정): 노랑(본인), 칙칙한 분홍빨강(다른 사람).
 * 하늘색(길드원), 초록(파티)은 일반적인 값.
 */
export const PLAYER_DOT_COLORS: readonly (readonly [number, number, number])[] = [
  [230, 250, 80],
  [150, 65, 95],
  [80, 220, 255],
  [60, 230, 60],
]
const DOT_TOL = 45

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
