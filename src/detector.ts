// 한 프레임에서 등록된 템플릿들을 찾고 숫자를 읽는다. 워커와 테스트에서 공용.

import { read, type DigitBank } from './core/digits'
import { cropRgba, fracToRect, type Rect, type Rgba } from './core/image'
import {
  findShape,
  findTemplate,
  foregroundMask,
  prepareShape,
  prepareTemplate,
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
}

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
}

interface Variant extends VariantSpec {
  ncc?: PreparedTemplate
  shape?: PreparedShape
}

interface Target extends TargetSpec {
  prepared: Variant[]
  last: { x: number; y: number; variant: number } | null
  lastRun: number
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
    }))
  }

  /** 이번 프레임에 검사한 대상의 결과만 돌려준다(간격이 남은 대상은 빠진다). */
  detect(frame: Rgba, now = 0): Detection[] {
    const out: Detection[] = []
    for (const t of this.targets) {
      if (t.intervalMs && now - t.lastRun < t.intervalMs) continue
      t.lastRun = now
      out.push(this.detectOne(frame, t))
    }
    return out
  }

  private searchVariant(frame: Rgba, v: Variant, area: Rect): MatchResult | null {
    const region = cropRgba(frame, area)
    const m = v.shape ? findShape(region, v.shape) : findTemplate(region, v.ncc!)
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

  private detectOne(frame: Rgba, t: Target): Detection {
    const full = fracToRect(t.region, frame.width, frame.height)
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
    m ??= this.searchAll(frame, t, full)

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
    }
  }
}
