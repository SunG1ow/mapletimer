// 한 프레임에서 등록된 템플릿들을 찾고 숫자를 읽는다. 워커와 테스트에서 공용.

import { read, type DigitBank } from './core/digits'
import { cropRgba, fracToRect, type Rect, type Rgba } from './core/image'
import { findMinimap } from './core/minimap'
import {
  findShape,
  findTemplate,
  foregroundMask,
  prepareShape,
  prepareTemplate,
  SearchRegion,
  type MatchResult,
  type PreparedShape,
  type PreparedTemplate,
} from './core/match'

export interface VariantSpec {
  rgba: Rgba
  digitRect: Rect | null
  bgTolerance?: number
}

export interface TargetSpec {
  id: string // 알림 id 또는 'rune'
  region: Rect // 비율
  variants: VariantSpec[]
  /** 'ncc' = 아이콘(상관계수), 'shape' = 룬(배경 무시, 일부 가려져도 허용) */
  method: 'ncc' | 'shape'
  threshold: number
  /** 이 간격(ms)마다만 검사. 없으면 매 프레임 */
  intervalMs?: number
  /** region 안에서 미니맵 창을 찾아 그 안만 탐색(룬). 못 찾으면 region 전체 */
  withinMinimap?: boolean
}

/** 안 보이는 대상의 전체 화면 재탐색 간격. 보이는 동안은 직전 위치 주변만 보므로 매 프레임 싸다. */
const RESCAN_MS = 1000
/**
 * 한 프레임에서 할 전체 탐색 수 상한. 버프 7개가 모두 꺼져 있으면 1초마다 한 프레임에 몰려
 * 처리 시간이 튀므로(실측 1초 이상) 여러 프레임에 나눈다. 방금 놓친 대상이 먼저.
 */
const FULL_SEARCHES_PER_FRAME = 2

export interface DetectorConfig {
  digitBank: DigitBank
  targets: TargetSpec[]
}

export interface Detection {
  id: string
  found: boolean
  score: number
  variant: number
  x: number
  y: number
  text: string | null
  worst: number | null
  digitCrop: Rgba | null
  /** withinMinimap 대상: 찾은 미니맵 영역(못 찾으면 null) */
  minimap?: Rect | null
}

interface Variant extends VariantSpec {
  ncc?: PreparedTemplate
  shape?: PreparedShape
}

interface Target extends TargetSpec {
  prepared: Variant[]
  last: { x: number; y: number; variant: number } | null
  lastRun: number
  lastFullSearch: number
}

type Hit = MatchResult & { variant: number }

export class Detector {
  private targets: Target[] = []
  private bank: DigitBank = { threshold: 220, samples: [] }

  configure(cfg: DetectorConfig) {
    this.bank = cfg.digitBank
    this.targets = cfg.targets.map((t) => ({
      ...t,
      prepared: t.variants.map((v) =>
        t.method === 'shape'
          ? { ...v, shape: prepareShape(v.rgba, foregroundMask(v.rgba, v.bgTolerance ?? 40)) }
          : { ...v, ncc: prepareTemplate(v.rgba, v.digitRect) },
      ),
      last: null,
      lastRun: -Infinity,
      lastFullSearch: -Infinity,
    }))
  }

  /** 이번 프레임에 검사한 대상의 결과만 돌려준다(간격이 남은 대상은 빠진다). */
  detect(frame: Rgba, now = 0): Detection[] {
    this.regions.clear()
    this.budget = FULL_SEARCHES_PER_FRAME
    const due = this.targets.filter((t) => !(t.intervalMs && now - t.lastRun < t.intervalMs))
    // 보이던 대상(직전 위치 있음)을 먼저 처리해 위치를 놓쳤을 때 전체 탐색 예산을 우선 쓰게 한다.
    const order = [...due].sort((a, b) => Number(!!b.last) - Number(!!a.last))
    const results = new Map<Target, Detection>()
    for (const t of order) {
      t.lastRun = now
      results.set(t, this.detectOne(frame, t, now))
    }
    return due.map((t) => results.get(t)!)
  }

  private regions = new Map<string, SearchRegion>()
  private budget = FULL_SEARCHES_PER_FRAME

  /** 같은 프레임에서 같은 영역을 보는 템플릿끼리 회색조/채널 변환을 공유한다. */
  private region(frame: Rgba, area: Rect): SearchRegion {
    const key = `${area.x},${area.y},${area.w},${area.h}`
    let r = this.regions.get(key)
    if (!r) {
      r = new SearchRegion(cropRgba(frame, area))
      this.regions.set(key, r)
    }
    return r
  }

  private searchVariant(frame: Rgba, v: Variant, area: Rect): MatchResult | null {
    const region = this.region(frame, area)
    const m = v.shape ? findShape(region.rgba, v.shape) : findTemplate(region, v.ncc!)
    return m ? { x: m.x + area.x, y: m.y + area.y, score: m.score } : null
  }

  private searchAll(frame: Rgba, t: Target, area: Rect): Hit | null {
    let best: Hit | null = null
    t.prepared.forEach((v, i) => {
      const m = this.searchVariant(frame, v, area)
      if (m && (!best || m.score > best.score)) best = { ...m, variant: i }
    })
    return best
  }

  private detectOne(frame: Rgba, t: Target, now: number): Detection {
    let full = fracToRect(t.region, frame.width, frame.height)
    let minimap: Rect | null | undefined
    if (t.withinMinimap) {
      minimap = findMinimap(frame, full)
      if (minimap) full = minimap
    }
    let m: Hit | null = null
    // 직전 위치 주변을 먼저 본다. 대부분 프레임은 여기서 끝나 전체 탐색 비용을 아낀다.
    if (t.last) {
      const pad = 12
      const { width: w, height: h } = t.prepared[t.last.variant].rgba
      const x0 = Math.max(full.x, t.last.x - pad)
      const y0 = Math.max(full.y, t.last.y - pad)
      const near = {
        x: x0,
        y: y0,
        w: Math.min(full.x + full.w, t.last.x + w + pad) - x0,
        h: Math.min(full.y + full.h, t.last.y + h + pad) - y0,
      }
      m = this.searchAll(frame, t, near)
      if (m && m.score < t.threshold) m = null
    }
    // 간격 검사 대상(룬)은 미니맵 안만 보므로 싸서 예산과 무관하게 매번 전체 탐색.
    const wantFull = !m && (t.last || t.intervalMs || now - t.lastFullSearch >= RESCAN_MS)
    if (wantFull && (t.intervalMs || this.budget > 0)) {
      if (!t.intervalMs) this.budget--
      t.lastFullSearch = now
      m = this.searchAll(frame, t, full)
    }

    const found = !!m && m.score >= t.threshold
    t.last = found && m ? { x: m.x, y: m.y, variant: m.variant } : null
    let text: string | null = null
    let worst: number | null = null
    let digitCrop: Rgba | null = null
    const dr = found && m ? t.prepared[m.variant].digitRect : null
    if (found && m && dr) {
      digitCrop = cropRgba(frame, { x: m.x + dr.x, y: m.y + dr.y, w: dr.w, h: dr.h })
      const r = read(this.bank, digitCrop)
      if (r) {
        text = r.text
        worst = r.worst
      }
    }
    return {
      id: t.id,
      found,
      score: m?.score ?? 0,
      variant: m?.variant ?? -1,
      x: m?.x ?? -1,
      y: m?.y ?? -1,
      text,
      worst,
      digitCrop,
      ...(t.withinMinimap ? { minimap } : {}),
    }
  }
}
