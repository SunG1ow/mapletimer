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
