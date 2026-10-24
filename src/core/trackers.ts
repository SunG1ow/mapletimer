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

/** 'lost' = 끝날 때가 아닌데 안 보임(다른 창·이펙트에 가려짐 등). 알림 없이 남은 시간을 계속 센다. */
export type TimedEvent = 'alert' | 'expired' | 'refreshed' | 'appeared' | 'disappeared' | 'lost'

export interface TimedStatus {
  present: boolean
  /** 끝날 때가 아닌데 안 보이는 중(가려짐) */
  lost: boolean
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
/**
 * 아이콘이 사라졌을 때 남은 시간이 이 이하면 진짜 종료로 본다(마지막 5초는 깜빡이고 서버 랙도 있다).
 * 그보다 많이 남았는데 안 보이면 가려진 것: 실사용에서 30분 쿠폰이 15분대에 '종료'로 여러 번 오탐했다.
 */
const PLAUSIBLE_END_SEC = 15
/**
 * 추적 중에 남은 시간이 갑자기 줄어드는 읽기는 오독이다(버프 시간은 저절로 줄지 않는다. 실사용: 6분대 물약을
 * '0:12'처럼 읽어 20초 전 알림). 지금 추정이 이 시간(1분) 넘게 한 번도 맞는 읽기를 받지 못했을 때만 고친다.
 */
const DOWNWARD_FIX_MS = 60000
/** 가려진 채로 예상 종료 시각이 이만큼 지나면 종료로 본다 */
const LOST_EXPIRE_GRACE_MS = 3000

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
  lost = false
  expiresAt: number | null = null
  fired = false
  private lastSeen = 0
  /** 지금 추정과 맞는 읽기를 마지막으로 받은 시각 */
  private lastSupport = 0
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
    this.lost = false
    this.expiresAt = null
    this.fired = false
    this.candidates = []
  }

  status(now: number): TimedStatus {
    return {
      present: this.present,
      lost: this.lost,
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
        if (this.lost) {
          // 가려졌다가 다시 보임: 같은 버프를 이어서 추적한다.
          this.lost = false
        } else {
          ev.push('appeared')
          if (o.mode === 'appear') {
            this.expiresAt = now + o.durationSec * 1000
            this.fired = false
          }
        }
      }
      if (o.mode === 'ocr' && obs.remainingSec !== null) this.applyReading(obs.remainingSec, now, ev)
    } else if (this.present && now - this.lastSeen > (o.missGraceMs ?? 2000)) {
      this.present = false
      const remaining = this.expiresAt === null ? null : (this.expiresAt - now) / 1000
      // 남은 시간을 알면 그것으로, 모르면 'N초 전' 알림이 이미 울렸는지로 끝날 때인지 판단한다.
      const plausibleEnd = remaining !== null ? remaining <= PLAUSIBLE_END_SEC : this.fired
      if (plausibleEnd) this.end(ev)
      else {
        this.lost = true
        ev.push('lost')
      }
    } else if (this.lost && this.expiresAt !== null && now - this.expiresAt > LOST_EXPIRE_GRACE_MS) {
      // 가려진 채로 끝날 시각이 지났다.
      this.lost = false
      this.end(ev)
    }

    // 화면에 alertBeforeSec 이하 숫자가 보이는 순간 알린다(남은 시간은 표시값 + 0.5초로 추정하므로 0.5초 여유).
    // 가려진 동안에도 남은 시간을 알고 있으면 알린다.
    if ((this.present || this.lost) && this.expiresAt !== null && !this.fired && this.expiresAt - now <= (o.alertBeforeSec + 0.5) * 1000) {
      this.fired = true
      ev.push('alert')
    }
    return ev
  }

  private end(ev: TimedEvent[]) {
    ev.push('disappeared')
    if (this.opts.alertOnExpire) ev.push('expired')
    this.expiresAt = null
    this.candidates = []
    this.fired = false
  }

  private applyReading(sec: number, now: number, ev: TimedEvent[]) {
    // 화면 숫자는 내림 표시라 실제 남은 시간은 sec ~ sec+1 사이. 중간값을 쓴다.
    const expires = now + (sec + 0.5) * 1000
    if (this.expiresAt !== null && Math.abs(expires - this.expiresAt) <= TOLERANCE_SEC * 1000) {
      this.expiresAt = this.expiresAt * 0.7 + expires * 0.3
      this.candidates = []
      this.lastSupport = now
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
    const earlier = this.expiresAt !== null && c.expires < this.expiresAt - TOLERANCE_SEC * 1000
    if (earlier && now - this.lastSupport < DOWNWARD_FIX_MS) return

    this.lastSupport = now
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

export interface HuntStopOptions {
  stopSec: number
  repeatSec: number
}

export type HuntStopEvent = 'stopped' | 'resumed'

/** 경험치 변화가 stopSec 동안 없으면 알리고, 다시 변할 때까지 repeatSec마다 반복한다. */
export class HuntStopTracker {
  private lastChange: number | null = null
  private lastAlert: number | null = null
  private opts: HuntStopOptions

  constructor(opts: HuntStopOptions) {
    this.opts = opts
  }

  setOptions(opts: HuntStopOptions) {
    this.opts = opts
  }

  reset() {
    this.lastChange = null
    this.lastAlert = null
  }

  get stopped() {
    return this.lastAlert !== null
  }

  /** 마지막 경험치 변화 후 지난 시간(초) */
  idleSec(now: number): number | null {
    return this.lastChange === null ? null : (now - this.lastChange) / 1000
  }

  update(changed: boolean, now: number): HuntStopEvent[] {
    const ev: HuntStopEvent[] = []
    // 처음 보기 시작한 시점부터 잰다(공유 시작 직후 바로 울리지 않게).
    if (this.lastChange === null || changed) {
      if (changed && this.lastAlert !== null) ev.push('resumed')
      this.lastChange = now
      this.lastAlert = null
      return ev
    }
    const idle = now - this.lastChange
    if (idle < this.opts.stopSec * 1000) return ev
    if (this.lastAlert === null || now - this.lastAlert >= this.opts.repeatSec * 1000) {
      this.lastAlert = now
      ev.push('stopped')
    }
    return ev
  }
}
