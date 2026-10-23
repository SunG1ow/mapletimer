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
/**
 * 새 시간(처음 잡기/갱신/급변)을 받아들이는 조건: 같은 만료 시각을 가리키는 읽기가 이 시간 이상에 걸쳐
 * CONFIRM_READS번 이상. 화면 숫자는 1초마다 바뀌고 초당 여러 번 읽으므로, 숫자 하나를 잘못 읽으면
 * 같은 오답이 1초 동안 반복된다(실측). 진짜 남은 시간은 숫자가 줄어도 만료 시각이 그대로라 이 조건을 통과한다.
 */
const CONFIRM_MS = 2000
const CONFIRM_READS = 3
/** 후보끼리 같은 만료 시각으로 볼 범위(읽은 값은 내림 표시라 ±0.5초 오차) */
const CANDIDATE_TOL_MS = 1200

interface Candidate {
  firstAt: number
  lastAt: number
  expires: number // 평균
  min: number
  max: number
  reads: number
}

export class TimedTracker {
  present = false
  expiresAt: number | null = null
  fired = false
  private lastSeen = 0
  private candidates: Candidate[] = []
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
    this.candidates = []
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
      this.candidates = []
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
      this.candidates = []
      return
    }
    // 처음 읽었거나 예측과 크게 다르면 후보로 모아 두고, 시간에 걸쳐 확인된 것만 받아들인다.
    this.candidates = this.candidates.filter((c) => now - c.lastAt <= 3000)
    let c = this.candidates.find((x) => Math.abs(expires - x.expires) <= CANDIDATE_TOL_MS)
    if (!c) {
      c = { firstAt: now, lastAt: now, expires, min: expires, max: expires, reads: 0 }
      this.candidates.push(c)
      if (this.candidates.length > 3) this.candidates.shift()
    }
    c.expires = (c.expires * c.reads + expires) / (c.reads + 1)
    c.min = Math.min(c.min, expires)
    c.max = Math.max(c.max, expires)
    c.reads++
    c.lastAt = now
    // 멈춘 숫자는 시간이 갈수록 만료 시각이 밀리므로 범위가 넓어져 걸러진다.
    if (c.reads < CONFIRM_READS || now - c.firstAt < CONFIRM_MS || c.max - c.min > CANDIDATE_TOL_MS) return

    const refreshed = this.expiresAt !== null && c.expires > this.expiresAt + TOLERANCE_SEC * 1000
    this.expiresAt = c.expires
    this.candidates = []
    if (refreshed) ev.push('refreshed')
    // 다시 알림 시점보다 넉넉히 남았을 때만 알림을 새로 준비한다(이미 지난 시점에서 또 울리지 않게).
    if (this.expiresAt - now > (this.opts.alertBeforeSec + 1.5) * 1000) this.fired = false
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
