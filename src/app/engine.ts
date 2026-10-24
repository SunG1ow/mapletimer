// 워커 감지 결과 → 추적기 → 알림. React 바깥에서 동작해 탭이 가려져도 알림이 늦지 않는다.

import type { Settings, TimedAlert } from '../config'
import { MAX_GLYPH_DISTANCE } from '../core/digits'
import type { Rgba } from '../core/image'
import { parseRemaining } from '../core/time'
import type { ExpChange } from '../core/expwatch'
import { HuntStopTracker, PresenceTracker, TimedTracker, type TimedOptions } from '../core/trackers'
import type { Detection } from '../detector'
import { fireAlert } from './sound'

export interface TargetStatus {
  found: boolean
  score: number
  variant: number
  minimap?: { x: number; y: number; w: number; h: number } | null
  text: string | null
  remainingSec: number | null
  digitCrop: Rgba | null
  /** 최근 5초 안의 마지막 이벤트(갱신됨 등 표시용) */
  lastEvent: string | null
  /** 버프: 끝날 때가 아닌데 안 보임(가려짐). 룬: 미니맵이 가려져 판단 보류 */
  covered?: boolean
}

const EVENT_SHOW_MS = 5000

export interface HuntStatus {
  /** 마지막 경험치 변화 후 지난 시간(초) */
  idleSec: number | null
  stopped: boolean
  /** 이번 프레임에 바뀐 픽셀 수(확인용) */
  diffPx: number
}

export interface EngineSnapshot {
  at: number
  frameMs: number
  targets: Record<string, TargetStatus>
  hunt: HuntStatus | null
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
  return `${a.speech || a.name} ${alertSuffix(a, kind)}`
}

function alertSuffix(a: TimedAlert, kind: 'alert' | 'expired'): string {
  return kind === 'alert' ? `${a.alertBeforeSec}초 전` : '종료'
}

/** 같이 먹은 도핑 여러 개가 동시에 끝날 때 알림을 한 문장으로 묶는다. */
export function groupText(names: string[], suffix: string): string {
  if (names.length <= 2) return `${names.join(', ')} ${suffix}`
  return `${names[0]} 외 ${names.length - 1}개 ${suffix}`
}

const BUFF_GROUP_MS = 1200

// 플레이어가 룬 위에 서서 잠깐 다 가려도 "사라짐"으로 보지 않도록 몇 번 연속 놓쳐야 사라진 것으로 본다.
function runeOptions(s: Settings) {
  return { repeatSec: s.rune.repeatSec, hitsToAppear: 2, missesToDisappear: 5 }
}

export class Engine {
  private settings: Settings
  private timed = new Map<string, TimedTracker>()
  private rune: PresenceTracker
  private lastEvents = new Map<string, { ev: string; at: number }>()
  snapshot: EngineSnapshot = { at: 0, frameMs: 0, targets: {}, hunt: null }
  private hunt = new HuntStopTracker({ stopSec: 60, repeatSec: 15 })
  private pending: { suffix: string; names: string[]; pattern?: number[] }[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private onChange: (s: EngineSnapshot) => void = () => {}
  private onLog: (line: string) => void = () => {}

  constructor(settings: Settings) {
    this.settings = settings
    this.rune = new PresenceTracker(runeOptions(settings))
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
    this.rune.setOptions(runeOptions(s))
    this.hunt.setOptions({ stopSec: s.huntStop.stopSec, repeatSec: s.huntStop.repeatSec })
    if (!s.huntStop.enabled) this.hunt.reset()
  }

  reset() {
    this.timed.forEach((t) => t.reset())
    this.rune.reset()
    this.hunt.reset()
  }

  private alert(text: string, pattern?: number[]) {
    this.onLog(text)
    const s = this.settings
    if (s.allMuted) return
    fireAlert(text, { volume: s.volume, speech: s.speechEnabled, desktop: s.notifyEnabled }, pattern)
  }

  /** 버프 알림은 잠깐 모았다가 같은 내용끼리 한 번에 알린다. */
  private buffAlert(a: TimedAlert, kind: 'alert' | 'expired', pattern?: number[]) {
    const suffix = alertSuffix(a, kind)
    let p = this.pending.find((x) => x.suffix === suffix)
    if (!p) {
      p = { suffix, names: [], pattern }
      this.pending.push(p)
    }
    const name = a.speech || a.name
    if (!p.names.includes(name)) p.names.push(name)
    this.flushTimer ??= setTimeout(() => this.flush(), BUFF_GROUP_MS)
  }

  private flush() {
    this.flushTimer = null
    const list = this.pending
    this.pending = []
    for (const p of list) this.alert(groupText(p.names, p.suffix), p.pattern)
  }

  private recentEvent(id: string, now: number): string | null {
    const e = this.lastEvents.get(id)
    return e && now - e.at <= EVENT_SHOW_MS ? e.ev : null
  }

  handle(detections: Detection[], frameMs: number, now = Date.now(), exp: ExpChange | null = null) {
    // 룬처럼 몇 초 간격으로만 검사하는 대상은 이번 프레임에 결과가 없으니 직전 상태를 유지한다.
    const targets: Record<string, TargetStatus> = { ...this.snapshot.targets }
    for (const d of detections) {
      // 판단 보류된 프레임은 추적기에 넣지 않는다(없음으로 세면 가짜 '종료'/'룬' 알림이 날 수 있다).
      if (d.skipped) {
        if (d.id === RUNE_ID && targets[d.id]) targets[d.id] = { ...targets[d.id], covered: true }
        continue
      }
      if (d.id === RUNE_ID) {
        if (!this.settings.rune.enabled) continue
        for (const ev of this.rune.update(d.found, now)) {
          if (ev === 'alert') this.alert(this.settings.rune.speech || '룬', [660, 990, 1320])
          this.lastEvents.set(d.id, { ev, at: now })
        }
        targets[d.id] = { ...base(d), remainingSec: null, lastEvent: this.recentEvent(d.id, now), covered: false }
        continue
      }
      const a = this.settings.timed.find((x) => x.id === d.id)
      const tracker = this.timed.get(d.id)
      if (!a || !tracker || !a.enabled) continue
      const reliable = d.text !== null && d.worst !== null && d.worst <= MAX_GLYPH_DISTANCE
      const remaining = reliable ? parseRemaining(d.text!, a.colonUnit, a.plainUnit) : null
      for (const ev of tracker.update({ found: d.found, remainingSec: remaining }, now)) {
        const pattern = ev === 'expired' ? [1175, 880] : undefined
        if (ev === 'alert' || ev === 'expired') {
          if (a.group === 'buff') this.buffAlert(a, ev, pattern)
          else this.alert(alertText(a, ev), pattern)
        }
        this.lastEvents.set(d.id, { ev, at: now })
      }
      const st = tracker.status(now)
      targets[d.id] = {
        ...base(d),
        remainingSec: st.remainingSec,
        lastEvent: this.recentEvent(d.id, now),
        covered: st.lost,
      }
    }
    let hunt: HuntStatus | null = null
    if (exp && this.settings.huntStop.enabled) {
      for (const ev of this.hunt.update(exp.changed, now)) {
        if (ev === 'stopped') this.alert(this.settings.huntStop.speech || '사냥 멈춤', [523, 392, 523, 392])
        else this.onLog('사냥 재개')
      }
      hunt = { idleSec: this.hunt.idleSec(now), stopped: this.hunt.stopped, diffPx: exp.diffPx }
    }
    this.snapshot = { at: now, frameMs, targets, hunt }
    this.onChange(this.snapshot)
  }
}

function base(d: Detection) {
  return { found: d.found, score: d.score, variant: d.variant, text: d.text, digitCrop: d.digitCrop, minimap: d.minimap }
}
