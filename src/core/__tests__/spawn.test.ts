import { describe, expect, it } from 'vitest'
import { SpawnTracker, type SpawnEvent, type SpawnOptions } from '../spawn'
import recorded from './spawn-activity.json'

/** 실사용 영상(밤의 길 3, 1.5분)을 4fps로 본 프레임 변화량. 젠 12번, 실측 간격 7.53초. */
const REC = recorded as { dtMs: number; activity: number[] }
const OPTS: SpawnOptions = { periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }

function run(t: SpawnTracker, acts: number[], dtMs = 250) {
  const out: { at: number; ev: SpawnEvent }[] = []
  acts.forEach((a, i) => t.update(i === 0 ? null : a, i * dtMs).forEach((ev) => out.push({ at: i * dtMs, ev })))
  return out
}
const of = (out: { at: number; ev: SpawnEvent }[], ev: SpawnEvent) => out.filter((e) => e.ev === ev).map((e) => e.at)

interface Scene {
  totalMs: number
  /** 젠 시각들(ms) */
  spawns: number[]
  /** 젠 때 30 → 35 → 45로 오른다(실사용 관찰). 아니면 바로 50(녹화 영상) */
  ramp?: boolean
  /** 이벤트로 화면이 계속 30 안팎인 구간 */
  busy?: [number, number][]
  /** 조용하다가 젠처럼 크게 터지는 엉뚱한 시각(이벤트 몹 등) */
  fakes?: number[]
  /** 조용하다가 30까지만 오르는 시각(이벤트) */
  weak?: number[]
}

/** 4fps 프레임 변화량: 평소 7, 젠 뒤 3초 사냥 35~45 */
function scene(s: Scene): number[] {
  const acts: number[] = []
  for (let t = 0; t < s.totalMs; t += 250) {
    let a = 7
    for (const x of s.spawns) {
      const d = t - x
      if (d > 0 && d <= 3000) a = Math.max(a, s.ramp ? [30, 35, 45][Math.ceil(d / 250) - 1] ?? 40 : d <= 250 ? 50 : 40)
    }
    for (const f of s.fakes ?? []) if (t - f > 0 && t - f <= 1000) a = Math.max(a, 45)
    for (const w of s.weak ?? []) if (t - w > 0 && t - w <= 1500) a = Math.max(a, 28)
    for (const [from, to] of s.busy ?? []) if (t >= from && t < to) a = Math.max(a, 30)
    acts.push(a)
  }
  return acts
}

const every = (first: number, period: number, until: number) => {
  const out: number[] = []
  for (let t = first; t < until; t += period) out.push(Math.round(t))
  return out
}

/**
 * 박자를 잡은 뒤 모든 젠에 알림이 하나씩, 젠보다 lead±tol 앞서 울렸는지.
 * 여기서는 프레임(0.25초)마다만 update하므로 알림이 다음 프레임까지 늦을 수 있다(앱은 타이머로 제 시각에 울린다).
 */
function expectAlerts(alerts: number[], spawns: number[], from: number, leadMs: number, tolMs: number) {
  const due = spawns.filter((s) => s - leadMs > from + 300)
  for (const s of due) {
    const hit = alerts.filter((a) => a - (s - leadMs) >= -tolMs && a - (s - leadMs) <= tolMs + 250)
    expect(hit.length, `${(s / 1000).toFixed(2)}초 젠 알림`).toBe(1)
  }
  // 장면 끝 직후 젠의 알림은 장면 안에 울릴 수 있으므로 마지막 젠까지만 센다
  const last = spawns[spawns.length - 1] - leadMs + tolMs
  expect(alerts.filter((a) => a > from && a <= last).length).toBe(due.length)
}

describe('SpawnTracker — 실사용 영상', () => {
  it('젠 3번으로 박자를 잡고, 이후 젠마다 0.5초 전에 알린다(오알림·놓침 없음)', () => {
    const t = new SpawnTracker(OPTS)
    const out = run(t, REC.activity, REC.dtMs)
    expect(of(out, 'ignored')).toEqual([])
    expect(of(out, 'lost')).toEqual([])
    expect(of(out, 'locked')).toEqual([19250]) // 4.25, 11.75, 19.25초 젠으로 박자 잡음
    expect(of(out, 'spawn')).toHaveLength(9)
    const spawns = [26.75, 34.25, 41.75, 49.25, 56.75, 64.5, 71.75, 79.5, 86.75].map((s) => s * 1000)
    const alerts = of(out, 'alert')
    expect(alerts).toHaveLength(9)
    // 젠을 본 프레임(실제 젠은 그 앞 0~0.25초)보다 0.25~1.25초 앞
    spawns.forEach((s, i) => {
      expect(s - alerts[i]).toBeGreaterThanOrEqual(250)
      expect(s - alerts[i]).toBeLessThanOrEqual(1250)
    })
    expect(t.status(90000).periodSec).toBeCloseTo(7.53, 1)
  })

  it('알림 간격 2면 박자 잡은 젠부터 세어 두 번째마다 알린다', () => {
    const one = of(run(new SpawnTracker(OPTS), REC.activity), 'alert')
    const two = of(run(new SpawnTracker({ ...OPTS, everyN: 2 }), REC.activity), 'alert')
    expect(two).toEqual(one.filter((_, i) => i % 2 === 1))
  })

  it('설정 주기를 7.2초로 짐작해도 실제 7.53초를 찾는다', () => {
    const t = new SpawnTracker({ ...OPTS, periodSec: 7.2 })
    const out = run(t, REC.activity)
    expect(of(out, 'lost')).toEqual([])
    expect(of(out, 'alert')).toHaveLength(9)
    expect(t.status(90000).periodSec).toBeCloseTo(7.53, 1)
  })
})

describe('SpawnTracker — 젠 판정', () => {
  it('30 → 35 → 45로 천천히 올라도 오르기 시작한 때를 젠으로 본다', () => {
    const spawns = every(2000, 7530, 60000)
    const t = new SpawnTracker(OPTS)
    const out = run(t, scene({ totalMs: 60000, spawns, ramp: true }))
    expect(of(out, 'locked')).toHaveLength(1)
    expectAlerts(of(out, 'alert'), spawns, of(out, 'locked')[0], 500, 300)
  })

  it('30 안팎까지만 오르는 변화(이벤트)는 젠이 아니다', () => {
    const out = run(new SpawnTracker(OPTS), scene({ totalMs: 60000, spawns: [], weak: every(3000, 7530, 60000) }))
    expect(of(out, 'weak').length).toBeGreaterThan(5)
    expect(of(out, 'locked')).toEqual([])
  })
})

describe('SpawnTracker — 이벤트가 이어져도 밀리지 않는다(실사용: 한 번 밀리면 이벤트가 없어도 계속 밀림)', () => {
  it('실제 7.53초, 4분 동안 긴 이벤트 두 번 + 엉뚱한 터짐 여럿이 섞여도 모든 젠에 제때 알린다', () => {
    const spawns = every(2000, 7530, 240000)
    // 엉뚱한 터짐: 조용한 틈(젠 4~7초 뒤)에 무작위 위상으로
    const fakes = [26000, 47500, 63200, 91000, 118700, 152300, 171900, 205600, 226800].map((f) => {
      const k = Math.floor((f - 2000) / 7530)
      return 2000 + k * 7530 + 4000 + ((f * 7) % 2500)
    })
    const s: Scene = { totalMs: 240000, spawns, ramp: true, busy: [[60000, 105000], [150000, 175000]], fakes }
    const out = run(new SpawnTracker(OPTS), scene(s))
    expect(of(out, 'lost')).toEqual([])
    const locked = of(out, 'locked')
    expect(locked).toHaveLength(1)
    expectAlerts(of(out, 'alert'), spawns, locked[0], 500, 300)
  })

  it('잘못된 박자를 먼저 잡아도(엉뚱한 터짐 셋) 진짜 젠이 쌓이면 진짜 박자로 바꾼다', () => {
    const spawns = every(30000, 7530, 150000)
    const fakes = [2000, 9530, 17060] // 젠 박자와 3초 어긋난 같은 간격
    const out = run(new SpawnTracker(OPTS), scene({ totalMs: 150000, spawns, fakes }))
    const locked = of(out, 'locked')
    expect(locked.length).toBe(2)
    expectAlerts(of(out, 'alert'), spawns, locked[1] + 7530, 500, 300)
  })
})

describe('SpawnTracker — 쉬기·이동', () => {
  it('쉬었다가(마을 등) 같은 사냥터로 돌아오면 젠 하나로 바로 다시 알린다', () => {
    const all = every(2000, 7530, 130000)
    const spawns = all.filter((s) => s < 40000 || s > 80000)
    const out = run(new SpawnTracker(OPTS), scene({ totalMs: 130000, spawns }))
    const lost = of(out, 'lost')[0]
    const resumed = of(out, 'resumed')[0]
    expect(lost).toBeGreaterThan(40000)
    expect(resumed).toBeLessThan(spawns.find((s) => s > 80000)! + 500)
    const alerts = of(out, 'alert')
    expect(alerts.filter((a) => a > lost && a < resumed)).toEqual([])
    expectAlerts(alerts, spawns, resumed, 500, 300)
  })

  it('다른 사냥터(다른 박자)로 옮기면 새 박자를 잡는다', () => {
    const first = every(2000, 7530, 40000)
    const second = every(58000, 7530, 130000) // 위상이 다른 박자
    const out = run(new SpawnTracker(OPTS), scene({ totalMs: 130000, spawns: [...first, ...second] }))
    const locked = of(out, 'locked')
    expect(locked).toHaveLength(2)
    expectAlerts(of(out, 'alert'), second, locked[1], 500, 300)
  })

  it('계속 바쁘기만 한 화면에서는 박자를 잡지 않는다', () => {
    const out = run(new SpawnTracker(OPTS), Array.from({ length: 400 }, (_, i) => 30 + ((i * 37) % 25)))
    expect(of(out, 'locked')).toEqual([])
    expect(of(out, 'alert')).toEqual([])
  })
})

describe('SpawnTracker.nextAlertAt / 기록', () => {
  it('다음 알림 시각을 미리 알려 주고, 그 시각에 update하면 정확히 그때 알린다', () => {
    const t = new SpawnTracker({ ...OPTS, alertBeforeSec: 0.7 })
    let i = 0
    for (; i < REC.activity.length; i++) if (t.update(i === 0 ? null : REC.activity[i], i * REC.dtMs).includes('locked')) break
    const due = t.nextAlertAt()!
    expect(t.update(null, due - 1)).toEqual([])
    expect(t.update(null, due)).toEqual(['alert'])
    expect(t.nextAlertAt()! - due).toBeCloseTo(t.status(due).periodSec * 1000, 0)
  })

  it('프레임마다 변화량과 판정을 남긴다', () => {
    const t = new SpawnTracker(OPTS)
    run(t, REC.activity)
    const log = t.getLog()
    expect(log).toHaveLength(REC.activity.length)
    expect(log.filter((r) => r.events.includes('alert'))).toHaveLength(9)
  })
})

describe('SpawnTracker — 기본 주기(실측 7.57초)', () => {
  const opts: SpawnOptions = { periodSec: 7.57, alertBeforeSec: 0.5, everyN: 1 }

  it('젠 3번이 흔들려 주기를 틀리게 잡을 수 있어도, 곧이은 이벤트 동안 밀리지 않는다', () => {
    // 실제 7.57초. 처음 젠 3번 중 마지막이 0.2초 늦게 보이면 젠 3개만으로는 7.67초로도 맞아든다.
    const spawns = every(2000, 7570, 90000)
    const seen = spawns.map((s, i) => (i === 2 ? s + 200 : s))
    // 박자 잡은 직후부터 60초 동안 이벤트(젠이 안 보임)
    const acts = scene({ totalMs: 90000, spawns: seen, ramp: true, busy: [[17500, 77000]] })
    const out = run(new SpawnTracker(opts), acts)
    const locked = of(out, 'locked')
    expect(locked).toHaveLength(1)
    expect(of(out, 'lost')).toEqual([])
    expectAlerts(of(out, 'alert'), spawns, locked[0], 500, 300)
  })

  it('젠 3번만으로 잡은 주기도 기본값(실측) 가까이 둔다', () => {
    const spawns = every(2000, 7570, 20000).map((s, i) => (i === 2 ? s + 200 : s))
    const t = new SpawnTracker(opts)
    run(t, scene({ totalMs: 20000, spawns, ramp: true }))
    // 젠 3개만 보면 7.67초로 맞아들지만, 실측 기본값 쪽으로 둔다
    expect(Math.abs(t.status(20000).periodSec - 7.57)).toBeLessThan(0.015)
  })

  it('실제 주기가 기본값과 달라도(7.52초) 젠이 쌓이면 실측을 따른다', () => {
    const spawns = every(2000, 7520, 150000)
    const t = new SpawnTracker(opts)
    const out = run(t, scene({ totalMs: 150000, spawns, ramp: true }))
    expectAlerts(of(out, 'alert'), spawns, of(out, 'locked')[0] + 40000, 500, 250)
    expect(t.status(150000).periodSec).toBeCloseTo(7.52, 2)
  })
})
