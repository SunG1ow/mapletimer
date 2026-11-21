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

/** 조용함: 이 값 미만(실측 6~8, 영상 녹화는 잡음 때문에 최대 18) */
const QUIET = 12
/** 젠 직전에 조용함이 이만큼 이어져야 한다(4fps에서 3프레임) */
const QUIET_RUN_MS = 500
/** 조용하다가 이 값을 넘으면 '오르기 시작' */
const RISE = 20
/**
 * 오르기 시작한 뒤 이 시간 안에 PEAK 이상까지 올라야 젠. 실사용 관찰: 젠은 어떤 상황이든 30·35를 거쳐 45(가끔 50)까지,
 * 이벤트는 높아도 30 정도. 녹화 영상에서는 젠 순간 바로 45~81.
 */
const PEAK = 40
const PEAK_WITHIN_MS = 1250
/**
 * 박자: 최근 젠들 시각을 주기로 접었을 때 이만큼 안에 모이면 같은 박자(4fps 표본 오차 ±0.13초 + 서버 랙).
 * 젠마다 조금씩 고쳐 나가면 엉뚱한 젠 하나가 주기를 비틀어 계속 밀렸다(실사용: 6번째쯤부터 복구 불가).
 * 그래서 매번 최근 젠 전체로 주기·위상을 다시 고른다(가장 많이 맞는 쪽). 섞인 이벤트 터짐은 표가 모이지 않는다.
 */
const PHASE_TOL_MS = 250
/** 이 시간 안의 젠만 박자 계산에 쓴다. 가까운 젠일수록 무겁게(반감기) */
const ONSET_KEEP_MS = 240000
const HALF_LIFE_MS = 60000
/** 박자를 잡는 데 필요한 같은 박자의 젠 수 */
const MIN_SUPPORT = 3
/** 주기는 설정값의 ±6% 안에서 2ms 단위로 찾는다(7.5초 → 7.05~7.95초. 처음 짐작 7.2초, 실측 7.53초) */
const PERIOD_RANGE = 0.06
const PERIOD_STEP_MS = 2
/** 예상 젠 시각 앞뒤로 화면이 '조용했는데도' 젠이 없는 일이 이만큼 이어지면 사냥을 멈춘 것으로 보고 알림을 쉰다 */
const MAX_QUIET_MISSES = 3
/** 화면에 젠이 보인 뒤 프레임이 분석에 들어오기까지의 지연. 녹화 영상을 앱에 넣어 재 보니 보정 0이면 알림이 평균 0.1초 늦고, 0.1초면 0.1초 일렀다. */
const CAPTURE_LATENCY_MS = 50
/** 기록 내보내기용으로 남기는 프레임 수(4fps 30분) */
const LOG_MAX = 7200

export interface SpawnOptions {
  /** 젠 주기(초). 박자를 찾을 때 이 값의 ±6% 안에서 실제 주기를 찾는다 */
  periodSec: number
  /** 젠 이 시간(초) 전에 알림 */
  alertBeforeSec: number
  /** 몇 번째 젠마다 알릴지(1 = 매번) */
  everyN: number
}

/**
 * spawn = 젠을 봄(박자에 맞음), ignored = 젠 같은데 박자와 안 맞음, weak = 오르다 만 변화(이벤트 등),
 * locked = 박자 잡음/바뀜, lost = 사냥을 멈춘 듯해 알림 쉼(박자는 기억), resumed = 다시 알림, alert = 알림
 */
export type SpawnEvent = 'spawn' | 'ignored' | 'weak' | 'locked' | 'lost' | 'resumed' | 'alert'

export interface SpawnStatus {
  locked: boolean
  /** 박자는 기억하지만 알림을 쉬는 중 */
  paused: boolean
  /** 찾은 주기(초). 박자를 못 잡았으면 설정값 */
  periodSec: number
  /** 박자 계산에 맞아든 최근 젠 수 */
  support: number
  /** 다음 젠까지(초). 박자를 못 잡았으면 null */
  nextInSec: number | null
  /** 화면이 바빠 젠을 못 보고 박자로만 넘긴 횟수(마지막으로 본 젠 이후) */
  blind: number
}

export interface SpawnLogRow {
  t: number
  activity: number | null
  events: SpawnEvent[]
}

interface Model {
  period: number
  /** 젠 시각 하나(이 시각 + 주기의 정수배가 젠) */
  ref: number
  support: number
}

type Mode = 'search' | 'locked' | 'paused'

export class SpawnTracker {
  private frames: { t: number; a: number }[] = []
  private quietStart: number | null = null
  private lastLowT: number | null = null
  private rising: { t0: number; until: number } | null = null
  private onsets: number[] = []
  private model: Model | null = null
  private mode: Mode = 'search'
  private pausedAt = 0
  /** N번마다 셈의 기준 젠 시각 */
  private origin = 0
  private lastAlertS = -Infinity
  private lastClosedS = -Infinity
  private quietMisses = 0
  private blind = 0
  private log: SpawnLogRow[] = []
  private opts: SpawnOptions

  constructor(opts: SpawnOptions) {
    this.opts = opts
  }

  setOptions(opts: SpawnOptions) {
    const refit = opts.periodSec !== this.opts.periodSec
    this.opts = opts
    if (refit) {
      this.model = null
      this.mode = 'search'
      this.refit(this.lastT())
    }
  }

  reset() {
    this.frames = []
    this.quietStart = null
    this.lastLowT = null
    this.rising = null
    this.onsets = []
    this.model = null
    this.mode = 'search'
  }

  private lastT() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0
  }

  /** 최근 프레임 기록(시각 ms, 변화량, 그 프레임의 판정) */
  getLog(): SpawnLogRow[] {
    return this.log
  }

  status(now: number): SpawnStatus {
    const m = this.model
    const base = { periodSec: (m?.period ?? this.opts.periodSec * 1000) / 1000, support: m?.support ?? 0, blind: this.blind }
    if (this.mode !== 'locked' || !m) return { ...base, locked: false, paused: this.mode === 'paused', nextInSec: null }
    const next = m.ref + Math.ceil((now - m.ref) / m.period) * m.period
    return { ...base, locked: true, paused: false, nextInSec: (next - now) / 1000 }
  }

  /** 다음 알림 시각(ms). 프레임은 0.25초 간격이라 엔진이 이 시각에 맞춰 타이머로 정확히 울린다. */
  nextAlertAt(): number | null {
    const m = this.model
    if (this.mode !== 'locked' || !m) return null
    let k = Math.floor((this.lastAlertS + m.period / 2 - m.ref) / m.period) + 1
    for (let i = 0; i < 20 && !this.everyOk(m.ref + k * m.period); i++) k++
    return m.ref + k * m.period - this.opts.alertBeforeSec * 1000
  }

  private everyOk(spawnT: number) {
    const n = Math.max(1, Math.round(this.opts.everyN))
    const k = Math.round((spawnT - this.origin) / this.model!.period)
    return ((k % n) + n) % n === 0
  }

  /** activity = 이번 프레임 변화량(null = 첫 프레임 등 모름) */
  update(activity: number | null, now: number): SpawnEvent[] {
    const ev: SpawnEvent[] = []
    if (activity !== null) this.detect(activity, now, ev)
    const m = this.model
    if (this.mode === 'locked' && m) {
      this.closeWindow(now, m, ev)
      if (this.mode === 'locked') {
        // 알림 시각이 지난 가장 최근 젠. 1초 넘게 늦었으면(창이 멈췄다 돌아옴 등) 건너뛴다.
        const lead = this.opts.alertBeforeSec * 1000
        const s = m.ref + Math.floor((now + lead - m.ref) / m.period) * m.period
        if (s > this.lastAlertS + m.period / 2) {
          this.lastAlertS = s
          if (now - (s - lead) < 1000 && this.everyOk(s)) ev.push('alert')
        }
      }
    }
    this.log.push({ t: now, activity, events: ev })
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX)
    return ev
  }

  /** 조용하다가 오르기 시작한 지점을 젠 후보로 잡고, 곧 PEAK까지 오르면 젠으로 확정한다. */
  private detect(a: number, now: number, ev: SpawnEvent[]) {
    this.frames.push({ t: now, a })
    this.frames = this.frames.filter((f) => now - f.t <= 3000)
    if (this.rising && now > this.rising.until) {
      this.rising = null
      ev.push('weak')
    }
    if (this.rising && a >= PEAK) {
      const t0 = this.rising.t0
      this.rising = null
      this.onOnset(t0, now, ev)
    }
    if (a < QUIET) {
      this.quietStart ??= now
      this.lastLowT = now
      return
    }
    const quietRun = this.quietStart !== null && this.lastLowT !== null ? this.lastLowT - this.quietStart : 0
    this.quietStart = null
    if (!this.rising && a >= RISE && quietRun >= QUIET_RUN_MS && this.lastLowT !== null && now - this.lastLowT < 1000) {
      // 젠은 마지막 조용한 프레임과 이번 프레임 사이 어딘가에서 일어났다.
      const t0 = (this.lastLowT + now) / 2 - CAPTURE_LATENCY_MS
      if (a >= PEAK) this.onOnset(t0, now, ev)
      else this.rising = { t0, until: now + PEAK_WITHIN_MS }
    }
  }

  private onOnset(t0: number, now: number, ev: SpawnEvent[]) {
    this.onsets = [...this.onsets.filter((t) => now - t <= ONSET_KEEP_MS), t0]
    const before = this.model
    if (this.mode === 'paused' && before && this.fits(before, t0)) {
      // 쉬는 동안 박자를 기억해 두었다가 맞는 젠 하나로 바로 다시 알린다(서버 젠 박자는 그대로다).
      this.mode = 'locked'
      this.seen(t0)
      this.lastAlertS = this.nearest(before, t0)
      const m = this.fit(this.onsets, now)
      if (m) this.model = m
      ev.push('resumed')
      return
    }
    if (this.mode === 'paused') {
      // 기억한 박자와 안 맞는 젠: 쉰 뒤의 젠만으로 새 박자가 서면 그쪽으로 바꾼다(다른 사냥터).
      const fresh = this.onsets.filter((t) => t >= this.pausedAt)
      const m = this.fit(fresh, now)
      if (m) {
        this.onsets = fresh
        this.lockTo(m, t0, ev)
      }
      return
    }
    const m = this.refit(now)
    if (!m) return
    if (this.mode === 'search' || !before) {
      this.lockTo(m, t0, ev)
      return
    }
    const switched = Math.abs(this.nearest(m, before.ref) - before.ref) > PHASE_TOL_MS
    if (switched) {
      this.lockTo(m, t0, ev)
      return
    }
    if (this.fits(m, t0)) {
      this.seen(t0)
      ev.push('spawn')
    } else ev.push('ignored')
  }

  private lockTo(m: Model, t0: number, ev: SpawnEvent[]) {
    this.model = m
    this.mode = 'locked'
    this.origin = this.nearest(m, t0)
    this.lastAlertS = this.origin // 방금 본 젠은 이미 지났으므로 알리지 않는다
    this.seen(t0)
    ev.push('locked')
  }

  private seen(t0: number) {
    this.quietMisses = 0
    this.blind = 0
    if (this.model) this.lastClosedS = Math.max(this.lastClosedS, this.nearest(this.model, t0))
  }

  private nearest(m: Model, t: number) {
    return m.ref + Math.round((t - m.ref) / m.period) * m.period
  }

  private fits(m: Model, t: number) {
    return Math.abs(t - this.nearest(m, t)) <= PHASE_TOL_MS
  }

  private refit(now: number): Model | null {
    const m = this.fit(this.onsets, now)
    if (m) this.model = m
    else if (this.mode !== 'paused') {
      this.model = null
      this.mode = 'search'
    }
    return m
  }

  /** 주기 후보마다 젠들을 접어 가장 많이(최근 젠일수록 무겁게) 모이는 위상을 고른다. 동점이면 더 꼭 맞는 쪽. */
  private fit(onsets: number[], now: number): Model | null {
    if (onsets.length < MIN_SUPPORT) return null
    const w = onsets.map((t) => Math.pow(0.5, (now - t) / HALF_LIFE_MS))
    const base = this.opts.periodSec * 1000
    let best: { score: number; resid: number; period: number; seed: number; count: number } | null = null
    for (let p = base * (1 - PERIOD_RANGE); p <= base * (1 + PERIOD_RANGE); p += PERIOD_STEP_MS) {
      for (const seed of onsets) {
        let score = 0
        let resid = 0
        let count = 0
        for (let i = 0; i < onsets.length; i++) {
          const d = onsets[i] - seed
          const off = d - Math.round(d / p) * p
          if (Math.abs(off) <= PHASE_TOL_MS) {
            score += w[i]
            resid += w[i] * off * off
            count++
          }
        }
        if (count < MIN_SUPPORT) continue
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && resid < best.resid)) {
          best = { score, resid, period: p, seed, count }
        }
      }
    }
    if (!best) return null
    // 맞아든 젠들의 가중 평균 위치로 위상을 다듬는다.
    let sw = 0
    let so = 0
    onsets.forEach((t, i) => {
      const d = t - best!.seed
      const off = d - Math.round(d / best!.period) * best!.period
      if (Math.abs(off) <= PHASE_TOL_MS) {
        sw += w[i]
        so += w[i] * off
      }
    })
    return { period: best.period, ref: best.seed + so / sw, support: best.count }
  }

  /** 젠 창(예상 시각 +0.5초)이 지나면: 봤으면 그만, 바빠서 못 봤으면 박자대로 넘김, 조용한데 없었으면 '멈춤' 쪽으로 센다. */
  private closeWindow(now: number, m: Model, ev: SpawnEvent[]) {
    const s = m.ref + Math.floor((now - 500 - m.ref) / m.period) * m.period
    if (s <= this.lastClosedS + m.period / 2) return
    this.lastClosedS = s
    const around = this.frames.filter((f) => f.t >= s - 1500 && f.t <= s + 500)
    const busy = around.length > 0 && around.reduce((x, f) => x + f.a, 0) / around.length >= QUIET
    if (busy) this.blind++
    else this.quietMisses++
    // 젠을 너무 오래 못 보면(박자 계산에 쓸 젠이 없음) 오차가 쌓였을 수 있으니 쉰다.
    const lastOnset = this.onsets.length ? this.onsets[this.onsets.length - 1] : -Infinity
    if (this.quietMisses >= MAX_QUIET_MISSES || now - lastOnset > ONSET_KEEP_MS) {
      this.mode = 'paused'
      this.pausedAt = now
      ev.push('lost')
    }
  }
}
