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

  it('젠을 몇 번 못 봐도(가려짐) 박자대로 계속 알리고, 4번 연속 놓치면 멈춘다', () => {
    // 25~40초 젠 2번은 화면이 계속 시끄러워 안 보임, 50초부터는 사냥 끝(계속 조용)
    const acts = synth(80000, 7500, 2000, (t) => (t >= 50000 ? 5 : t >= 25000 && t < 40000 ? 35 : null))
    const out = run(new SpawnTracker({ periodSec: 7.5, alertBeforeSec: 0.5, everyN: 1 }), acts, 250)
    const alerts = out.filter((e) => e.ev === 'alert').map((e) => e.at)
    expect(alerts).toContain(31500) // 32초 젠은 못 봤지만 알림
    const lost = out.find((e) => e.ev === 'lost')!
    expect(lost.at).toBeGreaterThan(70000)
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
