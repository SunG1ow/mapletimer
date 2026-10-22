// 워커 감지 결과 → 추적기 → 알림. React 바깥에서 동작해 탭이 가려져도 알림이 늦지 않는다.

import type { Settings, TimedAlert } from '../config'
import { MAX_GLYPH_DISTANCE } from '../core/digits'
import type { Rgba } from '../core/image'
import { parseRemaining } from '../core/time'
import { PresenceTracker, TimedTracker, type TimedOptions } from '../core/trackers'
import type { Detection } from '../detector'
import { fireAlert } from './sound'

export interface TargetStatus {
  found: boolean
  score: number
  text: string | null
  remainingSec: number | null
  digitCrop: Rgba | null
  lastEvent: string | null
}

export interface EngineSnapshot {
  at: number
  frameMs: number
  targets: Record<string, TargetStatus>
}

export const RUNE_ID = 'rune'

function timedOptions(a: TimedAlert): TimedOptions {
  return {
    mode: a.mode,
    durationSec: a.durationSec,
    alertBeforeSec: a.alertBeforeSec,
    alertOnExpire: a.alertOnExpire,
    missGraceMs: a.group === 'buff' ? 3000 : 2000,
  }
}

export function alertText(a: TimedAlert, kind: 'alert' | 'expired'): string {
  const name = a.speech || a.name
  return kind === 'alert' ? `${name} ${a.alertBeforeSec}초 전` : `${name} 종료`
}

export class Engine {
  private settings: Settings
  private timed = new Map<string, TimedTracker>()
  private rune: PresenceTracker
  private lastEvents = new Map<string, string>()
  snapshot: EngineSnapshot = { at: 0, frameMs: 0, targets: {} }
  private onChange: (s: EngineSnapshot) => void = () => {}
  private onLog: (line: string) => void = () => {}

  constructor(settings: Settings) {
    this.settings = settings
    this.rune = new PresenceTracker({ repeatSec: settings.rune.repeatSec })
    this.setSettings(settings)
  }

  listen(onChange: (s: EngineSnapshot) => void, onLog: (line: string) => void) {
    this.onChange = onChange
    this.onLog = onLog
  }

  setSettings(s: Settings) {
    this.settings = s
    const ids = new Set(s.timed.map((a) => a.id))
    for (const id of this.timed.keys()) if (!ids.has(id)) this.timed.delete(id)
    for (const a of s.timed) {
      const t = this.timed.get(a.id)
      if (t) t.setOptions(timedOptions(a))
      else this.timed.set(a.id, new TimedTracker(timedOptions(a)))
    }
    this.rune.setOptions({ repeatSec: s.rune.repeatSec })
  }

  reset() {
    this.timed.forEach((t) => t.reset())
    this.rune.reset()
  }

  private alert(text: string, pattern?: number[]) {
    this.onLog(text)
    const s = this.settings
    if (s.allMuted) return
    fireAlert(text, { volume: s.volume, speech: s.speechEnabled, desktop: s.notifyEnabled }, pattern)
  }

  handle(detections: Detection[], frameMs: number, now = Date.now()) {
    const targets: Record<string, TargetStatus> = {}
    for (const d of detections) {
      if (d.id === RUNE_ID) {
        if (!this.settings.rune.enabled) continue
        for (const ev of this.rune.update(d.found, now)) {
          if (ev === 'alert') this.alert(this.settings.rune.speech || '룬', [660, 990, 1320])
          this.lastEvents.set(d.id, ev)
        }
        targets[d.id] = { ...base(d), remainingSec: null, lastEvent: this.lastEvents.get(d.id) ?? null }
        continue
      }
      const a = this.settings.timed.find((x) => x.id === d.id)
      const tracker = this.timed.get(d.id)
      if (!a || !tracker || !a.enabled) continue
      const reliable = d.text !== null && d.worst !== null && d.worst <= MAX_GLYPH_DISTANCE
      const remaining = reliable ? parseRemaining(d.text!, a.colonUnit, a.plainUnit) : null
      for (const ev of tracker.update({ found: d.found, remainingSec: remaining }, now)) {
        if (ev === 'alert') this.alert(alertText(a, 'alert'))
        if (ev === 'expired') this.alert(alertText(a, 'expired'), [1175, 880])
        this.lastEvents.set(d.id, ev)
      }
      targets[d.id] = {
        ...base(d),
        remainingSec: tracker.status(now).remainingSec,
        lastEvent: this.lastEvents.get(d.id) ?? null,
      }
    }
    this.snapshot = { at: now, frameMs, targets }
    this.onChange(this.snapshot)
  }
}

function base(d: Detection) {
  return { found: d.found, score: d.score, text: d.text, digitCrop: d.digitCrop }
}
