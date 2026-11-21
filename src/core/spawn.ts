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
/** 예상 젠 시각과 이만큼 안쪽이면 젠으로 받아들인다(4fps 표본 오차 ±0.13초 + 서버 랙). 넓으면 이벤트 터짐이 박자를 끌고 간다 */
const WINDOW_MS = 500
/** 박자를 처음 잡을 때: 젠 후보 셋의 간격이 주기의 정수배와 이만큼 안쪽 */
const LOCK_TOL_MS = 600
/**
 * 예상 젠 시각 앞뒤로 화면이 '조용했는데도' 젠이 안 보인 횟수가 이만큼 이어지면 사냥을 멈춘 것으로 보고 알림을 쉰다.
 * 화면이 바빠(이벤트 몹·이벤트 스킬) 젠을 못 본 것은 세지 않는다: 실사용에서 이벤트 때마다 박자를 버려 절반가량 놓쳤다.
 */
const MAX_QUIET_MISSES = 3
/** 젠을 이 시간 넘게 한 번도 못 보면(주기 오차가 쌓임) 알림을 쉰다 */
const MAX_BLIND_MS = 180000
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

/**
 * spawn = 박자에 맞는 젠을 봄, ignored = 박자와 안 맞는 터짐, locked = 박자 잡음,
 * lost = 사냥을 멈춘 듯해 알림 쉼(박자는 기억), resumed = 기억한 박자에 맞는 젠을 다시 봐 알림 재개, alert = 알림
 */
export type SpawnEvent = 'spawn' | 'ignored' | 'locked' | 'lost' | 'resumed' | 'alert'

export interface SpawnStatus {
  locked: boolean
  /** 박자는 기억하지만 알림을 쉬는 중 */
  paused: boolean
  periodSec: number
  /** 다음 젠까지(초). 박자를 못 잡았으면 null */
  nextInSec: number | null
  /** 화면이 바빠 젠을 못 보고 박자로만 넘긴 횟수(마지막으로 본 젠 이후) */
  blind: number
}

type Mode = 'search' | 'locked' | 'paused'

export class SpawnTracker {
  private history: { t: number; a: number }[] = []
  private lastBurst = -Infinity
  /** 직전 프레임 시각. 젠은 직전 프레임과 이번 프레임 사이 어딘가에서 일어났으므로 그 가운데로 잡는다 */
  private lastT: number | null = null
  private candidates: number[] = []
  private mode: Mode = 'search'
  /** 기준 젠(번호 anchorC)의 시각 */
  private anchorT = 0
  private anchorC = 0
  /** 알림을 세는 기준 젠 번호(N번마다) */
  private baseC = 0
  private lastSeenC = 0
  private lastSeenT = 0
  private lastAlertC = 0
  /** 판정이 끝난(창이 지나간) 마지막 젠 번호 */
  private closedC = 0
  /** 지금 창이 열린 젠 번호와 그 앞뒤 화면 변화량 합/개수(바빠서 못 본 것인지 가리기용) */
  private windowC = 0
  private windowSum = 0
  private windowN = 0
  private quietMisses = 0
  private blind = 0
  private period: number
  private opts: SpawnOptions

  constructor(opts: SpawnOptions) {
    this.opts = opts
    this.period = opts.periodSec * 1000
  }

  setOptions(opts: SpawnOptions) {
    if (opts.periodSec !== this.opts.periodSec) {
      this.period = opts.periodSec * 1000
      this.mode = 'search'
      this.candidates = []
    }
    this.opts = opts
  }

  reset() {
    this.history = []
    this.lastBurst = -Infinity
    this.lastT = null
    this.mode = 'search'
    this.candidates = []
  }

  private at(c: number) {
    return this.anchorT + (c - this.anchorC) * this.period
  }

  status(now: number): SpawnStatus {
    const base = { periodSec: this.period / 1000, blind: this.blind }
    if (this.mode !== 'locked') return { ...base, locked: false, paused: this.mode === 'paused', nextInSec: null }
    const c = this.anchorC + Math.ceil((now - this.anchorT) / this.period)
    return { ...base, locked: true, paused: false, nextInSec: (this.at(c) - now) / 1000 }
  }

  /** 다음 알림 시각(ms). 프레임은 0.25초 간격이라 엔진이 이 시각에 맞춰 타이머로 정확히 울린다. */
  nextAlertAt(): number | null {
    if (this.mode !== 'locked') return null
    const n = Math.max(1, this.opts.everyN)
    let c = this.lastAlertC + 1
    while ((c - this.baseC) % n !== 0) c++
    return this.at(c) - this.opts.alertBeforeSec * 1000
  }

  /** activity = 이번 프레임 변화량(null = 첫 프레임 등 모름) */
  update(activity: number | null, now: number): SpawnEvent[] {
    const ev: SpawnEvent[] = []
    if (activity !== null) {
      this.history = this.history.filter((h) => now - h.t <= QUIET_MS)
      const before = this.history
      const quiet = before.length >= 2 && before.reduce((s, h) => s + h.a, 0) / before.length < QUIET
      this.history.push({ t: now, a: activity })
      if (this.mode !== 'search') this.watchWindow(activity, now)
      // 박자와 안 맞아 무시한 터짐은 대기 시간을 걸지 않는다(이벤트 몹 바로 뒤 진짜 젠을 놓치지 않게).
      const at = (this.lastT !== null && now - this.lastT < 1000 ? (this.lastT + now) / 2 : now) - CAPTURE_LATENCY_MS
      if (activity >= BURST && quiet && at - this.lastBurst > REFRACTORY_MS && this.onBurst(at, ev)) this.lastBurst = at
      this.lastT = now
    }
    if (this.mode === 'locked') this.closeWindows(now, ev)
    if (this.mode !== 'locked') return ev
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

  /** 예상 젠 시각 1.5초 전부터 창 끝까지의 화면 변화량을 모은다. 평균이 높으면 '바빠서 못 봄'. */
  private watchWindow(activity: number, now: number) {
    const c = this.anchorC + Math.round((now - this.anchorT) / this.period)
    const d = now - this.at(c)
    if (d < -(QUIET_MS + WINDOW_MS) || d > WINDOW_MS) return
    if (c !== this.windowC) {
      this.windowC = c
      this.windowSum = 0
      this.windowN = 0
    }
    this.windowSum += activity
    this.windowN++
  }

  /** 창이 지나간 젠마다: 봤으면 그만, 바빠서 못 봤으면 박자대로 넘김, 조용한데 없었으면 '멈춤' 쪽으로 센다. */
  private closeWindows(now: number, ev: SpawnEvent[]) {
    const lastClosable = this.anchorC + Math.floor((now - WINDOW_MS - this.anchorT) / this.period)
    for (let c = Math.max(this.closedC, this.lastSeenC) + 1; c <= lastClosable; c++) {
      this.closedC = c
      const busy = this.windowC === c && this.windowN > 0 && this.windowSum / this.windowN >= QUIET
      if (busy) this.blind++
      else this.quietMisses++
    }
    if (this.quietMisses >= MAX_QUIET_MISSES || now - this.lastSeenT > MAX_BLIND_MS) {
      this.mode = 'paused'
      this.candidates = []
      ev.push('lost')
    }
  }

  /** 젠(후보)으로 받아들였으면 true */
  private onBurst(t: number, ev: SpawnEvent[]): boolean {
    if (this.mode !== 'search') {
      const c = this.anchorC + Math.round((t - this.anchorT) / this.period)
      const err = t - this.at(c)
      if (Math.abs(err) <= WINDOW_MS && c > this.lastSeenC) {
        // 주기와 위상을 조금씩 실측에 맞춘다(표본 간격 250ms라 한 번 값은 ±0.13초 흔들린다).
        const base = this.opts.periodSec * 1000
        const n = c - this.anchorC
        this.period = Math.min(base * (1 + PERIOD_ADJUST), Math.max(base * (1 - PERIOD_ADJUST), this.period + (0.3 * err) / n))
        this.anchorT = t - 0.5 * err
        this.anchorC = c
        this.seen(c, t)
        if (this.mode === 'paused') {
          // 쉬는 동안 박자를 기억해 두었다가 맞는 젠 하나로 바로 다시 알린다(서버 젠 박자는 그대로다).
          this.mode = 'locked'
          this.lastAlertC = c
          ev.push('resumed')
        } else ev.push('spawn')
        return true
      }
      if (this.mode === 'locked') ev.push('ignored')
    }
    // 박자 찾는 중, 또는 기억한 박자와 안 맞는 터짐(이벤트 또는 다른 사냥터): 후보 중 주기의 정수배로 이어지는 셋을 찾는다.
    // 마지막 셋만 보면 이벤트 터짐 하나가 끼어도 계속 실패하므로 최근 후보 전부에서 찾는다. 박자를 잡은 중이면
    // 그 셋 사이에 기존 박자의 젠을 한 번도 못 봤을 때만 새 박자로 바꾼다(기존 박자가 살아 있으면 그쪽이 맞다).
    this.candidates = [...this.candidates.filter((x) => t - x <= this.period * 4.5), t]
    const locked = this.mode === 'locked'
    const fits = (gap: number) => {
      const k = Math.round(gap / this.period)
      return k >= 1 && k <= 3 && Math.abs(gap - k * this.period) <= LOCK_TOL_MS ? k : 0
    }
    for (const b of this.candidates.slice(0, -1)) {
      const k2 = fits(t - b)
      if (!k2) continue
      for (const a of this.candidates) {
        if (a >= b) break
        const k1 = fits(b - a)
        if (k1 && !(locked && this.lastSeenT >= a)) return this.lock(a, t, k1 + k2, ev)
      }
    }
    return !locked
  }

  private lock(a: number, t: number, cycles: number, ev: SpawnEvent[]): boolean {
    const base = this.opts.periodSec * 1000
    this.mode = 'locked'
    this.period = Math.min(base * (1 + PERIOD_ADJUST), Math.max(base * (1 - PERIOD_ADJUST), (t - a) / cycles))
    this.anchorT = t
    this.anchorC = 0
    this.baseC = 0
    this.closedC = 0
    this.lastAlertC = 0 // 방금 본 젠은 이미 지났으므로 알리지 않는다
    this.seen(0, t)
    this.candidates = []
    ev.push('locked')
    return true
  }

  private seen(c: number, t: number) {
    this.lastSeenC = c
    this.lastSeenT = t
    this.quietMisses = 0
    this.blind = 0
  }
}
