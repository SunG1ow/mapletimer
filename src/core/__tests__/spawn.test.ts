import { describe, expect, it } from 'vitest'
import { SpawnTracker, type SpawnEvent } from '../spawn'
import recorded from './spawn-activity.json'

/** 실사용 영상(밤의 길 3, 1.5분)을 4fps로 본 프레임 변화량. 젠 12번, 실측 간격 7.5초. */
const REC = recorded as { dtMs: number; activity: number[] }

function run(t: SpawnTracker, acts: number[], dtMs: number) {
  const out: { at: number; ev: SpawnEvent }[] = []
  acts.forEach((a, i) => t.update(i === 0 ? null : a, i * dtMs).forEach((ev) => out.push({ at: i * dtMs, ev })))
  return out
}

/** 조용함(5) 사이사이 periodMs마다 젠(터짐 50, 이후 3초 동안 사냥 35) */
function synth(totalMs: number, periodMs: number, firstMs: number, extra: (t: number) => number | null = () => null) {
  const acts: number[] = []
  for (let t = 0; t < totalMs; t += 250) {
    const since = (t - firstMs + periodMs * 100) % periodMs
    const base = t < firstMs ? 5 : since < 250 ? 50 : since < 3000 ? 35 : 5
    acts.push(extra(t) ?? base)
  }
  return acts
}

describe('SpawnTracker — 실사용 영상', () => {
  it('젠 3번으로 박자를 잡고, 이후 젠마다 0.5초 전에 알린다(오알림·놓침 없음)', () => {
    const t = new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 })
    const out = run(t, REC.activity, REC.dtMs)
    const spawns = out.filter((e) => e.ev === 'spawn' || e.ev === 'locked').map((e) => e.at / 1000)
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at / 1000)
    expect(out.filter((e) => e.ev === 'ignored' || e.ev === 'lost')).toEqual([])
    expect(out.find((e) => e.ev === 'locked')!.at).toBe(19250) // 4.25, 11.75, 19.25초 젠으로 박자 잡음
    expect(spawns).toHaveLength(10) // 박자 잡은 젠 + 이후 9번
    // 박자 잡은 뒤 젠마다 알림 하나, 실제 젠보다 0.25~1초 앞
    expect(alerts).toHaveLength(9)
    for (const s of spawns.slice(1)) expect(alerts.some((a) => s - a >= 0.0 && s - a <= 1.0), `${s}초 젠 알림`).toBe(true)
  })

  it('알림 시점 1초면 1초쯤 앞서, 2번마다면 절반만 알린다', () => {
    const one = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 1, everyN: 1 }), REC.activity, REC.dtMs)
    const two = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 1, everyN: 2 }), REC.activity, REC.dtMs)
    const spawns = one.filter((e) => e.ev === 'spawn').map((e) => e.at)
    const alerts = one.filter((e) => e.ev === 'alert').map((e) => e.at)
    for (const s of spawns) expect(alerts.some((a) => s - a >= 500 && s - a <= 1500)).toBe(true)
    expect(two.filter((e) => e.ev === 'alert').length).toBe(Math.floor(alerts.length / 2)) // 박자 잡은 젠부터 세어 2, 4, 6…번째
  })

  it('설정 주기가 조금 달라도(7.2초) 실측에 맞춰 잡는다', () => {
    const t = new SpawnTracker({ periodSec: 7.2, alertBeforeSec: 0.5, everyN: 1 })
    const out = run(t, REC.activity, REC.dtMs)
    expect(out.filter((e) => e.ev === 'lost')).toEqual([])
    expect(out.filter((e) => e.ev === 'spawn').length).toBeGreaterThanOrEqual(8)
    expect(t.status(REC.activity.length * REC.dtMs).periodSec).toBeCloseTo(7.5, 1)
  })
})

describe('SpawnTracker — 변수', () => {
  it('박자와 안 맞는 터짐(이벤트 몬스터·이벤트 스킬)은 무시한다', () => {
    // 25초 이후 조용한 틈마다 엉뚱한 시각(젠 5초 뒤)에 터짐, 그중 두 번은 젠 1.25초 전에 터짐
    const acts = synth(80000, 7500, 2000, (t) => {
      const since = (t - 2000) % 7500
      if (t > 25000 && since === 5000) return 60
      if ((t > 45000 && t < 46000) || (t > 53000 && t < 54000)) return since === 6250 ? 60 : null
      return null
    })
    const out = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }), acts, 250)
    expect(out.some((e) => e.ev === 'ignored')).toBe(true)
    expect(out.filter((e) => e.ev === 'lost')).toEqual([])
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at)
    // 알림은 모두 젠 0.5초 전(= 젠 시각 7000ms 위상)
    for (const a of alerts) expect((a + 500 - 2000) % 7500).toBe(0)
  })

  it('화면이 바빠 젠을 못 봐도 박자대로 계속 알리고, 조용한데 3번 연속 없으면 쉰다', () => {
    // 25~40초 젠 2번은 화면이 계속 시끄러워 안 보임, 50초부터는 사냥 끝(계속 조용)
    const acts = synth(80000, 7500, 2000, (t) => (t >= 50000 ? 5 : t >= 25000 && t < 40000 ? 35 : null))
    const out = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }), acts, 250)
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at)
    expect(alerts).toContain(31500) // 32초 젠은 못 봤지만 알림
    const lost = out.find((e) => e.ev === 'lost')!
    expect(lost.at).toBeGreaterThanOrEqual(69000) // 50초부터 조용: 54.5, 62, 69.5초 젠이 없음
    expect(alerts.every((a) => a < lost.at)).toBe(true)
  })

  it('조용하지 않은 채로 계속 바쁜 화면에서는 박자를 잡지 않는다', () => {
    const acts = Array.from({ length: 400 }, (_, i) => 30 + ((i * 37) % 25))
    const out = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }), acts, 250)
    expect(out).toEqual([])
  })
})

describe('SpawnTracker.nextAlertAt', () => {
  it('다음 알림 시각을 미리 알려 주고, 그 시각에 update하면 정확히 그때 알린다', () => {
    const t = new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.7, everyN: 1 })
    const acts = REC.activity
    let i = 0
    for (; i < acts.length; i++) if (t.update(i === 0 ? null : acts[i], i * REC.dtMs).includes('locked')) break
    const due = t.nextAlertAt()!
    // 박자 잡은 젠(직전 프레임과의 가운데) + 주기 − 0.7초
    expect(due - (i - 0.5) * REC.dtMs).toBeGreaterThan(7500 * 0.9 - 700)
    expect(due - (i - 0.5) * REC.dtMs).toBeLessThan(7500 * 1.1 - 700)
    expect(t.update(null, due - 1)).toEqual([])
    expect(t.update(null, due)).toEqual(['alert'])
    expect(t.nextAlertAt()).toBeCloseTo(due + 7500, -1)
  })
})

describe('SpawnTracker — 이벤트 뒤 회복(실사용: 이벤트 때마다 박자를 버려 절반가량 놓침)', () => {
  const opts = { periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }
  /** 젠 시각 위상(ms): 2000 + 7500k 에서 alertBefore 0.5초 */
  const onBeat = (a: number) => (a + 500 - 2000) % 7500 === 0

  it('이벤트로 1분 넘게 화면이 계속 바빠도 박자를 버리지 않고 알림을 이어 간다', () => {
    // 20~95초: 이벤트 몹이 3초마다 나와 화면이 계속 바쁨(조용한 틈 없음, 3초마다 큰 터짐)
    const acts = synth(130000, 7500, 2000, (t) => (t >= 20000 && t < 95000 ? (t % 3000 === 0 ? 60 : 35) : null))
    const out = run(new SpawnTracker(opts), acts, 250)
    expect(out.filter((e) => e.ev === 'lost')).toEqual([])
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at)
    expect(alerts.every(onBeat)).toBe(true)
    // 박자 잡은 17초 젠 뒤로 끝까지 모든 젠에 알림
    const expected = Array.from({ length: 15 }, (_, k) => 2000 + 7500 * (k + 3) - 500).filter((a) => a < 130000)
    expect(alerts).toEqual(expected)
    // 이벤트가 끝나면 다시 젠을 본다
    expect(out.some((e) => e.ev === 'spawn' && e.at > 95000)).toBe(true)
  })

  it('쉬었다가(마을 등) 같은 사냥터로 돌아오면 젠 하나로 바로 다시 알린다', () => {
    // 40~80초 조용(사냥 안 함) → 80초부터 다시 사냥(서버 젠 박자는 그대로)
    const acts = synth(120000, 7500, 2000, (t) => (t >= 40000 && t < 80000 ? 5 : null))
    const out = run(new SpawnTracker(opts), acts, 250)
    const lost = out.find((e) => e.ev === 'lost')!
    const resumed = out.find((e) => e.ev === 'resumed')!
    expect(lost.at).toBeGreaterThan(40000)
    expect(resumed.at).toBe(84500) // 80초 뒤 첫 젠(84.5초)
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at)
    expect(alerts.filter((a) => a > lost.at && a < resumed.at)).toEqual([])
    expect(alerts.filter((a) => a > resumed.at)).toEqual([91500, 99000, 106500, 114000])
  })

  it('박자를 찾는 중 젠 사이에 이벤트 터짐이 끼어도 잡는다', () => {
    // 처음부터 젠 사이(젠 5초 뒤)마다 이벤트 터짐
    const acts = synth(40000, 7500, 2000, (t) => ((t - 2000) % 7500 === 5000 ? 60 : null))
    const out = run(new SpawnTracker(opts), acts, 250)
    expect(out.find((e) => e.ev === 'locked')!.at).toBe(17000)
  })

  it('다른 사냥터(다른 박자)로 옮기면 새 박자를 잡는다', () => {
    const first = synth(40000, 7500, 2000)
    // 40~55초 이동(조용), 55초부터 위상이 3초 다른 박자
    const second = synth(60000, 7500, 18000).map((a, i) => (i * 250 < 15000 ? 5 : a))
    const out = run(new SpawnTracker(opts), [...first, ...second], 250)
    const locks = out.filter((e) => e.ev === 'locked').map((e) => e.at)
    expect(locks).toHaveLength(2)
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at).filter((a) => a > locks[1])
    for (const a of alerts) expect((a + 500 - 40000 - 18000) % 7500).toBe(0)
  })
})
