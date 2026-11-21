// 젠(몬스터 재생성) 박자 알림.
// 메이플은 서버가 정해진 간격(실측 7.5초)마다 몬스터를 다시 채운다. 실사용 영상(1.5분)을 보면 몬스터를 다 잡은 뒤
// 화면이 1~2초 조용하다가 젠 순간 공격 이펙트·데미지 숫자가 한꺼번에 터진다(프레임 변화량 약 5 → 50).
// 이 '조용하다가 터짐'을 젠으로 보고 박자(주기·위상)를 맞춘 뒤, 알림은 박자대로 낸다.
// 박자와 안 맞는 터짐(이벤트 몬스터, 이벤트 스킬, 캐릭터 이동)은 무시하고, 몇 번 놓쳐도 박자는 계속 간다.

import type { Rgba } from './image'

/** 화면을 이 간격(px)으로 듬성듬성 본다. 변화량은 화면 전체 평균이라 이 정도면 충분하다. */
const SAMPLE_STEP = 4

/** 직전 프레임과의 평균 밝기 차(0~255). 화면 크기·해상도와 거의 무관하다. */
export class ActivityWatcher {
  private prev: Uint8Array | null = null

  reset() {
    this.prev = null
  }

  update(img: Rgba): number | null {
    const cols = Math.ceil(img.width / SAMPLE_STEP)
    const rows = Math.ceil(img.height / SAMPLE_STEP)
    const cur = new Uint8Array(cols * rows * 3)
    let k = 0
    for (let y = 0; y < img.height; y += SAMPLE_STEP) {
      for (let x = 0; x < img.width; x += SAMPLE_STEP) {
        const i = (y * img.width + x) * 4
        cur[k++] = img.data[i]
        cur[k++] = img.data[i + 1]
        cur[k++] = img.data[i + 2]
      }
    }
    const prev = this.prev
    this.prev = cur
    if (!prev || prev.length !== cur.length) return null
    let sum = 0
    for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i] - prev[i])
    return sum / cur.length
  }
}

/** 이 값 이상 변하면 '터짐'(실측 젠 순간 30~56) */
const BURST = 30
/** 직전 1초 평균이 이 값 미만이면 '조용함'(실측 젠 직전 4~10, 사냥 중 20~45) */
const QUIET = 12
const QUIET_MS = 1000
/** 한 번 젠을 본 뒤 이 시간 안의 터짐은 같은 젠 */
const REFRACTORY_MS = 2000
/** 예상 젠 시각과 이만큼 안쪽이면 젠으로 받아들인다(4fps 표본 오차 + 서버 랙) */
const WINDOW_MS = 800
/** 박자를 처음 잡을 때: 연속된 젠 3번의 간격이 주기의 정수배와 이만큼 안쪽 */
const LOCK_TOL_MS = 600
/** 젠을 이만큼 연속으로 못 보면 박자를 놓친 것으로 보고 알림을 멈춘다(사냥터 이동, 정지 등) */
const MAX_MISSES = 4
/**
 * 화면에 젠이 보인 뒤 프레임이 분석에 들어오기까지의 지연. 녹화 영상을 앱에 넣어 잰 알림이 설정보다 평균 0.1초 늦었다.
 */
const CAPTURE_LATENCY_MS = 100
/** 주기는 설정값에서 이 비율 안에서만 스스로 고친다 */
const PERIOD_ADJUST = 0.1

export interface SpawnOptions {
  /** 젠 주기(초). 처음 박자를 잡을 때 기준, 이후 실측으로 조금씩 고친다 */
  periodSec: number
  /** 젠 이 시간(초) 전에 알림 */
  alertBeforeSec: number
  /** 몇 번째 젠마다 알릴지(1 = 매번) */
  everyN: number
}

/** spawn = 박자에 맞는 젠을 봄, ignored = 박자와 안 맞는 터짐, locked/lost = 박자 잡음/놓침, alert = 알림 */
export type SpawnEvent = 'spawn' | 'ignored' | 'locked' | 'lost' | 'alert'

export interface SpawnStatus {
  locked: boolean
  periodSec: number
  /** 다음 젠까지(초). 박자를 못 잡았으면 null */
  nextInSec: number | null
  /** 연속으로 놓친 젠 수 */
  misses: number
}

export class SpawnTracker {
  private history: { t: number; a: number }[] = []
  private lastBurst = -Infinity
  /** 직전 프레임 시각. 젠은 직전 프레임과 이번 프레임 사이 어딘가에서 일어났으므로 그 가운데로 잡는다 */
  private lastT: number | null = null
  private candidates: number[] = []
  private locked = false
  /** 기준 젠(번호 anchorC)의 시각 */
  private anchorT = 0
  private anchorC = 0
  /** 알림을 세는 기준 젠 번호(N번마다) */
  private baseC = 0
  private lastSeenC = 0
  private lastAlertC = 0
  private period: number
  private opts: SpawnOptions

  constructor(opts: SpawnOptions) {
    this.opts = opts
    this.period = opts.periodSec * 1000
  }

  setOptions(opts: SpawnOptions) {
    if (opts.periodSec !== this.opts.periodSec) {
      this.period = opts.periodSec * 1000
      this.unlock()
    }
    this.opts = opts
  }

  reset() {
    this.history = []
    this.lastBurst = -Infinity
    this.lastT = null
    this.unlock()
  }

  private unlock() {
    this.locked = false
    this.candidates = []
  }

  private at(c: number) {
    return this.anchorT + (c - this.anchorC) * this.period
  }

  status(now: number): SpawnStatus {
    if (!this.locked) return { locked: false, periodSec: this.period / 1000, nextInSec: null, misses: 0 }
    const c = this.anchorC + Math.ceil((now - this.anchorT) / this.period)
    return { locked: true, periodSec: this.period / 1000, nextInSec: (this.at(c) - now) / 1000, misses: this.misses(now) }
  }

  /** 다음 알림 시각(ms). 프레임은 0.25초 간격이라 엔진이 이 시각에 맞춰 타이머로 정확히 울린다. */
  nextAlertAt(): number | null {
    if (!this.locked) return null
    const n = Math.max(1, this.opts.everyN)
    let c = this.lastAlertC + 1
    while ((c - this.baseC) % n !== 0) c++
    return this.at(c) - this.opts.alertBeforeSec * 1000
  }

  /** 마지막으로 본 젠 뒤로, 예상 시각 + WINDOW_MS가 지나도록 안 보인 젠 수 */
  private misses(now: number) {
    const passed = this.anchorC + Math.floor((now - WINDOW_MS - this.anchorT) / this.period)
    return Math.max(0, passed - this.lastSeenC)
  }

  /** activity = 이번 프레임 변화량(null = 첫 프레임 등 모름) */
  update(activity: number | null, now: number): SpawnEvent[] {
    const ev: SpawnEvent[] = []
    if (activity !== null) {
      this.history = this.history.filter((h) => now - h.t <= QUIET_MS)
      const before = this.history
      const quiet = before.length >= 2 && before.reduce((s, h) => s + h.a, 0) / before.length < QUIET
      this.history.push({ t: now, a: activity })
      // 박자와 안 맞아 무시한 터짐은 대기 시간을 걸지 않는다(이벤트 몹 바로 뒤 진짜 젠을 놓치지 않게).
      const at = (this.lastT !== null && now - this.lastT < 1000 ? (this.lastT + now) / 2 : now) - CAPTURE_LATENCY_MS
      if (activity >= BURST && quiet && at - this.lastBurst > REFRACTORY_MS && this.onBurst(at, ev)) this.lastBurst = at
      this.lastT = now
    }
    if (!this.locked) return ev
    if (this.misses(now) >= MAX_MISSES) {
      this.unlock()
      ev.push('lost')
      return ev
    }
    // 알림 시각이 지난 가장 최근 젠. 1초 넘게 늦었으면(창이 멈췄다 돌아옴 등) 건너뛴다.
    const lead = this.opts.alertBeforeSec * 1000
    const c = this.anchorC + Math.floor((now + lead - this.anchorT) / this.period)
    if (c > this.lastAlertC) {
      this.lastAlertC = c
      const due = this.at(c) - lead
      if (now - due < 1000 && (c - this.baseC) % Math.max(1, this.opts.everyN) === 0) ev.push('alert')
    }
    return ev
  }

  /** 젠(후보)으로 받아들였으면 true */
  private onBurst(t: number, ev: SpawnEvent[]): boolean {
    if (this.locked) {
      const c = this.anchorC + Math.round((t - this.anchorT) / this.period)
      const err = t - this.at(c)
      if (Math.abs(err) > WINDOW_MS || c <= this.anchorC) {
        ev.push('ignored')
        return false
      }
      // 주기와 위상을 조금씩 실측에 맞춘다(표본 간격 250ms라 한 번 값은 ±0.25초 흔들린다).
      const base = this.opts.periodSec * 1000
      const n = c - this.anchorC
      this.period = Math.min(base * (1 + PERIOD_ADJUST), Math.max(base * (1 - PERIOD_ADJUST), this.period + (0.3 * err) / n))
      this.anchorT = t - 0.5 * err
      this.anchorC = c
      this.lastSeenC = c
      ev.push('spawn')
      return true
    }
    // 박자 찾는 중: 최근 젠 후보 셋이 주기의 정수배 간격으로 이어지면 박자를 잡는다.
    this.candidates = [...this.candidates.filter((x) => t - x <= this.period * 3.5), t]
    const [a, b] = this.candidates.slice(-3)
    if (this.candidates.length < 3) return true
    const k1 = Math.round((b - a) / this.period)
    const k2 = Math.round((t - b) / this.period)
    if (k1 < 1 || k2 < 1) return true
    if (Math.abs(b - a - k1 * this.period) > LOCK_TOL_MS || Math.abs(t - b - k2 * this.period) > LOCK_TOL_MS) return true
    this.locked = true
    this.period = Math.min(
      this.opts.periodSec * 1000 * (1 + PERIOD_ADJUST),
      Math.max(this.opts.periodSec * 1000 * (1 - PERIOD_ADJUST), (t - a) / (k1 + k2)),
    )
    this.anchorT = t
    this.anchorC = 0
    this.baseC = 0
    this.lastSeenC = 0
    this.lastAlertC = 0 // 방금 본 젠은 이미 지났으므로 알리지 않는다
    this.candidates = []
    ev.push('locked')
    return true
  }
}
