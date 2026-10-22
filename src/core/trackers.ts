// 감지 결과(프레임마다)를 받아 알림 시점을 결정하는 상태 기계. 시간은 ms 단위 now를 외부에서 넣는다.

export type TimedMode = 'ocr' | 'appear'

export interface TimedOptions {
  mode: TimedMode
  /** 'appear' 모드에서 아이콘이 나타난 뒤 유지되는 시간(초) */
  durationSec: number
  /** 남은 시간이 이 값 이하가 되면 알림 */
  alertBeforeSec: number
  /** 아이콘이 사라지면(만료) 알림 */
  alertOnExpire: boolean
  /** 이 시간 이상 안 보이면 사라진 것으로 판단 */
  missGraceMs?: number
}

export interface TimedObservation {
  found: boolean
  remainingSec: number | null // 숫자 인식 결과
}

export type TimedEvent = 'alert' | 'expired' | 'refreshed' | 'appeared' | 'disappeared'

export interface TimedStatus {
  present: boolean
  remainingSec: number | null
  fired: boolean
}

const TOLERANCE_SEC = 2.5

export class TimedTracker {
  present = false
  expiresAt: number | null = null
  fired = false
  private lastSeen = 0
  private candidate: { at: number; expires: number } | null = null
  private opts: TimedOptions

  constructor(opts: TimedOptions) {
    this.opts = opts
  }

  setOptions(opts: TimedOptions) {
    // 알림 시점이 바뀌면 이번 주기에서 다시 판단한다.
    if (opts.alertBeforeSec !== this.opts.alertBeforeSec) this.fired = false
    this.opts = opts
  }

  reset() {
    this.present = false
    this.expiresAt = null
    this.fired = false
    this.candidate = null
  }

  status(now: number): TimedStatus {
    return {
      present: this.present,
      remainingSec: this.expiresAt === null ? null : Math.max(0, (this.expiresAt - now) / 1000),
      fired: this.fired,
    }
  }

  update(obs: TimedObservation, now: number): TimedEvent[] {
    const ev: TimedEvent[] = []
    const o = this.opts
    if (obs.found) {
      this.lastSeen = now
      if (!this.present) {
        this.present = true
        ev.push('appeared')
        if (o.mode === 'appear') {
          this.expiresAt = now + o.durationSec * 1000
          this.fired = false
        }
      }
      if (o.mode === 'ocr' && obs.remainingSec !== null) this.applyReading(obs.remainingSec, now, ev)
    } else if (this.present && now - this.lastSeen > (o.missGraceMs ?? 2000)) {
      this.present = false
      ev.push('disappeared')
      if (o.alertOnExpire) ev.push('expired')
      this.expiresAt = null
      this.candidate = null
      this.fired = false
    }

    // 화면에 alertBeforeSec 이하 숫자가 보이는 순간 알린다(남은 시간은 표시값 + 0.5초로 추정하므로 0.5초 여유).
    if (this.present && this.expiresAt !== null && !this.fired && this.expiresAt - now <= (o.alertBeforeSec + 0.5) * 1000) {
      this.fired = true
      ev.push('alert')
    }
    return ev
  }

  private applyReading(sec: number, now: number, ev: TimedEvent[]) {
    // 화면 숫자는 내림 표시라 실제 남은 시간은 sec ~ sec+1 사이. 중간값을 쓴다.
    const expires = now + (sec + 0.5) * 1000
    if (this.expiresAt !== null && Math.abs(expires - this.expiresAt) <= TOLERANCE_SEC * 1000) {
      this.expiresAt = this.expiresAt * 0.7 + expires * 0.3
      this.candidate = null
      return
    }
    // 처음 읽었거나 예측과 크게 다르면, 연속 두 번 일치할 때만 받아들인다(오인식 방지).
    if (this.candidate && Math.abs(expires - this.candidate.expires) <= TOLERANCE_SEC * 1000) {
      const refreshed = this.expiresAt !== null && expires > this.expiresAt
      this.expiresAt = expires
      this.candidate = null
      if (refreshed) {
        ev.push('refreshed')
        this.fired = false
      }
      return
    }
    this.candidate = { at: now, expires }
  }
}

export interface PresenceOptions {
  /** 감지되어 있는 동안 반복 알림 간격(초). 0이면 한 번만 */
  repeatSec: number
  hitsToAppear?: number
  missesToDisappear?: number
}

export type PresenceEvent = 'alert' | 'appeared' | 'disappeared'

/** 룬처럼 "보이면 알림" 하는 대상. */
export class PresenceTracker {
  present = false
  private hits = 0
  private misses = 0
  private lastAlert = 0
  private opts: PresenceOptions

  constructor(opts: PresenceOptions) {
    this.opts = opts
  }

  setOptions(opts: PresenceOptions) {
    this.opts = opts
  }

  reset() {
    this.present = false
    this.hits = 0
    this.misses = 0
  }

  update(found: boolean, now: number): PresenceEvent[] {
    const ev: PresenceEvent[] = []
    if (found) {
      this.hits++
      this.misses = 0
      if (!this.present && this.hits >= (this.opts.hitsToAppear ?? 2)) {
        this.present = true
        this.lastAlert = now
        ev.push('appeared', 'alert')
      } else if (this.present && this.opts.repeatSec > 0 && now - this.lastAlert >= this.opts.repeatSec * 1000) {
        this.lastAlert = now
        ev.push('alert')
      }
    } else {
      this.misses++
      this.hits = 0
      if (this.present && this.misses >= (this.opts.missesToDisappear ?? 3)) {
        this.present = false
        ev.push('disappeared')
      }
    }
    return ev
  }
}
