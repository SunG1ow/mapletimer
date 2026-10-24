import { describe, expect, it } from 'vitest'
import { parseRemaining } from '../time'
import { PresenceTracker, TimedTracker } from '../trackers'

describe('parseRemaining', () => {
  it('형식별 해석', () => {
    expect(parseRemaining('2:43')).toBe(163)
    expect(parseRemaining('2:43', 'hm')).toBe(2 * 3600 + 43 * 60)
    expect(parseRemaining('39')).toBe(39)
    expect(parseRemaining('5', 'ms', 'm')).toBe(300)
    expect(parseRemaining('1:02:03')).toBe(3723)
    expect(parseRemaining('2:?3')).toBeNull()
    expect(parseRemaining('2:75')).toBeNull()
    expect(parseRemaining('0:12')).toBeNull() // 1분 미만은 '12'로 표시되므로 오독
    expect(parseRemaining('05')).toBeNull()
    expect(parseRemaining('0')).toBe(0)
  })
})

describe('TimedTracker (숫자 인식)', () => {
  const opts = { mode: 'ocr' as const, durationSec: 0, alertBeforeSec: 10, alertOnExpire: true }

  it('남은 시간이 알림 시점이 되면 한 번 알린다', () => {
    const t = new TimedTracker(opts)
    const events: string[] = []
    for (let s = 0; s <= 40; s++) {
      const ev = t.update({ found: true, remainingSec: 40 - s }, s * 1000)
      events.push(...ev.map((e) => `${s}:${e}`))
    }
    expect(events.filter((e) => e.endsWith('alert'))).toEqual(['30:alert'])
  })

  it('한 번 튄 오인식은 무시하고, 갱신(시간 증가)은 받아들여 다시 알린다', () => {
    const t = new TimedTracker(opts)
    const ev: string[] = []
    const feed = (s: number, r: number | null) => ev.push(...t.update({ found: true, remainingSec: r }, s * 1000).map((e) => `${s}:${e}`))
    feed(0, 30)
    feed(1, 29)
    feed(2, 88) // 오인식
    feed(3, 27)
    expect(Math.round(t.status(3000).remainingSec!)).toBe(28)
    for (let s = 4; s <= 22; s++) feed(s, 30 - s)
    expect(ev).toContain('20:alert')
    feed(23, 60) // 재사용
    feed(24, 59)
    feed(25, 58)
    expect(ev).toContain('25:refreshed')
    for (let s = 26; s <= 75; s++) feed(s, 83 - s)
    expect(ev.filter((e) => e.endsWith('alert'))).toEqual(['20:alert', '73:alert'])
  })

  it('같은 오답이 1초 동안 반복돼도(초당 4번 읽기) 갱신으로 보지 않는다', () => {
    const t = new TimedTracker(opts)
    const ev: string[] = []
    const feed = (ms: number, r: number) => ev.push(...t.update({ found: true, remainingSec: r }, ms).map((e) => `${ms}:${e}`))
    // 진짜: 25초부터 감소. 12초 남았을 때 '12'를 '16'으로 1초 동안 잘못 읽음
    for (let ms = 0; ms <= 20000; ms += 250) {
      const real = Math.floor(25 - ms / 1000)
      feed(ms, real === 12 ? 16 : real)
    }
    expect(ev.filter((e) => e.endsWith('refreshed'))).toEqual([])
    expect(ev.filter((e) => e.endsWith('alert'))).toHaveLength(1)
  })

  it('멈춘 숫자(같은 값 계속)는 받아들이지 않는다', () => {
    const t = new TimedTracker(opts)
    for (let ms = 0; ms <= 5000; ms += 250) t.update({ found: true, remainingSec: 6 }, ms)
    expect(t.status(5000).remainingSec).toBeNull()
  })

  it('끝날 때 아이콘이 사라지면 만료 알림', () => {
    const t = new TimedTracker(opts)
    for (let ms = 0; ms <= 3000; ms += 250) t.update({ found: true, remainingSec: Math.floor(6 - ms / 1000) }, ms)
    expect(t.update({ found: false, remainingSec: null }, 4000)).toEqual([])
    expect(t.update({ found: false, remainingSec: null }, 5500)).toEqual(['disappeared', 'expired'])
  })
})

describe('TimedTracker (가려짐과 진짜 종료 구분)', () => {
  const opts = { mode: 'ocr' as const, durationSec: 0, alertBeforeSec: 20, alertOnExpire: true, missGraceMs: 3000 }
  const run = (t: TimedTracker, from: number, to: number, f: (s: number) => { found: boolean; remainingSec: number | null }) => {
    const ev: string[] = []
    for (let ms = from; ms <= to; ms += 250) ev.push(...t.update(f(ms / 1000), ms).map((e) => `${(ms / 1000).toFixed(2)}:${e}`))
    return ev
  }

  it('15분 남았는데 몇 초~수십 초 안 보이면 종료가 아니라 가려짐으로 보고, 다시 보이면 이어서 추적한다', () => {
    const t = new TimedTracker(opts)
    // 900초(15분) 남은 버프를 읽다가 10초~40초 동안 가려짐
    const ev = run(t, 0, 60000, (s) => (s >= 10 && s < 40 ? { found: false, remainingSec: null } : { found: true, remainingSec: Math.floor(900 - s) }))
    expect(ev.filter((e) => e.endsWith('expired'))).toEqual([])
    expect(ev.some((e) => e.endsWith('lost'))).toBe(true)
    expect(t.present).toBe(true)
    expect(Math.round(t.status(60000).remainingSec!)).toBe(840)
  })

  it('가려진 동안에도 N초 전 알림은 울리고, 가려진 채 끝나면 종료를 한 번 알린다', () => {
    const t = new TimedTracker(opts)
    // 60초 남은 버프를 5초 읽고, 그 뒤로 계속 가려짐
    const ev = run(t, 0, 70000, (s) => (s < 5 ? { found: true, remainingSec: Math.floor(60 - s) } : { found: false, remainingSec: null }))
    expect(ev.filter((e) => e.endsWith('alert'))).toHaveLength(1)
    expect(ev.filter((e) => e.endsWith('expired'))).toHaveLength(1)
    const expiredAt = Number(ev.find((e) => e.endsWith('expired'))!.split(':')[0])
    expect(expiredAt).toBeGreaterThan(63)
    expect(expiredAt).toBeLessThan(64.5)
  })

  it('남은 시간을 모를 때(10분 이상 표시) 안 보여도 종료로 보지 않는다', () => {
    const t = new TimedTracker(opts)
    const ev = run(t, 0, 20000, (s) => ({ found: s < 5, remainingSec: null }))
    expect(ev.filter((e) => e.endsWith('expired'))).toEqual([])
  })
})

describe('TimedTracker (줄어드는 쪽 오독 거부)', () => {
  it('6분대를 계속 12초로 잘못 읽어도(앞자리 탈락) 20초 전 알림을 내지 않는다', () => {
    const t = new TimedTracker({ mode: 'ocr', durationSec: 0, alertBeforeSec: 20, alertOnExpire: true })
    const ev: string[] = []
    for (let ms = 0; ms <= 15000; ms += 250) {
      const real = Math.floor(400 - ms / 1000)
      // 처음 5초는 제대로, 그 뒤 10초는 분 자리를 놓쳐 초만 읽음(일관되게 줄어드는 오답)
      const read = ms < 5000 ? real : real % 60
      ev.push(...t.update({ found: true, remainingSec: read }, ms).map((e) => `${ms}:${e}`))
    }
    expect(ev.filter((e) => e.endsWith('alert'))).toEqual([])
    expect(Math.round(t.status(15000).remainingSec!)).toBe(385)
  })
})

describe('TimedTracker (등장 기준)', () => {
  it('등장 후 지속시간 - 알림시점에 알린다', () => {
    const t = new TimedTracker({ mode: 'appear', durationSec: 60, alertBeforeSec: 5, alertOnExpire: false })
    expect(t.update({ found: true, remainingSec: null }, 0)).toEqual(['appeared'])
    expect(t.update({ found: true, remainingSec: null }, 54000)).toEqual([])
    expect(t.update({ found: true, remainingSec: null }, 55000)).toEqual(['alert'])
  })
})

describe('PresenceTracker', () => {
  it('두 번 연속 보이면 알리고 반복 간격마다 다시 알린다', () => {
    const p = new PresenceTracker({ repeatSec: 10 })
    expect(p.update(true, 0)).toEqual([])
    expect(p.update(true, 500)).toEqual(['appeared', 'alert'])
    expect(p.update(true, 5000)).toEqual([])
    expect(p.update(true, 10500)).toEqual(['alert'])
    p.update(false, 11000)
    p.update(false, 11500)
    expect(p.update(false, 12000)).toEqual(['disappeared'])
  })
})
