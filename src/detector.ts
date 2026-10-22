// 한 프레임에서 등록된 템플릿들을 찾고 숫자를 읽는다. 워커와 테스트에서 공용.

import { read, type DigitBank } from './core/digits'
import { cropRgba, fracToRect, type Rect, type Rgba } from './core/image'
import { findTemplate, prepareTemplate, type PreparedTemplate } from './core/match'

export interface TargetSpec {
  id: string // 알림 id 또는 'rune'
  region: Rect // 비율
  rgba: Rgba
  digitRect: Rect | null
}

export interface DetectorConfig {
  threshold: number
  digitBank: DigitBank
  targets: TargetSpec[]
}

export interface Detection {
  id: string
  found: boolean
  score: number
  x: number
  y: number
  text: string | null
  worst: number | null
  digitCrop: Rgba | null
}

interface Target extends TargetSpec {
  prepared: PreparedTemplate
  last: { x: number; y: number } | null
}

export class Detector {
  private targets: Target[] = []
  private threshold = 0.8
  private bank: DigitBank = { threshold: 190, samples: [] }

  configure(cfg: DetectorConfig) {
    this.threshold = cfg.threshold
    this.bank = cfg.digitBank
    this.targets = cfg.targets.map((t) => ({
      ...t,
      prepared: prepareTemplate(t.rgba, t.digitRect),
      last: null,
    }))
  }

  detect(frame: Rgba): Detection[] {
    return this.targets.map((t) => this.detectOne(frame, t))
  }

  private search(frame: Rgba, t: Target, area: Rect) {
    const region = cropRgba(frame, area)
    const m = findTemplate(region, t.prepared)
    return m ? { x: m.x + area.x, y: m.y + area.y, score: m.score } : null
  }

  private detectOne(frame: Rgba, t: Target): Detection {
    const full = fracToRect(t.region, frame.width, frame.height)
    let m: { x: number; y: number; score: number } | null = null
    // 직전 위치 주변을 먼저 본다. 대부분 프레임은 여기서 끝나 전체 탐색 비용을 아낀다.
    if (t.last) {
      const pad = 12
      const near = {
        x: Math.max(full.x, t.last.x - pad),
        y: Math.max(full.y, t.last.y - pad),
        w: 0,
        h: 0,
      }
      near.w = Math.min(full.x + full.w, t.last.x + t.prepared.width + pad) - near.x
      near.h = Math.min(full.y + full.h, t.last.y + t.prepared.height + pad) - near.y
      m = this.search(frame, t, near)
      if (m && m.score < this.threshold) m = null
    }
    if (!m) m = this.search(frame, t, full)

    const found = !!m && m.score >= this.threshold
    t.last = found && m ? { x: m.x, y: m.y } : null
    let text: string | null = null
    let worst: number | null = null
    let digitCrop: Rgba | null = null
    if (found && m && t.digitRect) {
      digitCrop = cropRgba(frame, {
        x: m.x + t.digitRect.x,
        y: m.y + t.digitRect.y,
        w: t.digitRect.w,
        h: t.digitRect.h,
      })
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
      x: m?.x ?? -1,
      y: m?.y ?? -1,
      text,
      worst,
      digitCrop,
    }
  }
}
