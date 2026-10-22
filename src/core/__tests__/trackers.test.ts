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
    expect(ev).toContain('24:refreshed')
    for (let s = 25; s <= 75; s++) feed(s, 83 - s)
    expect(ev.filter((e) => e.endsWith('alert'))).toEqual(['20:alert', '73:alert'])
  })

  it('아이콘이 사라지면 만료 알림', () => {
    const t = new TimedTracker(opts)
    t.update({ found: true, remainingSec: 3 }, 0)
    expect(t.update({ found: false, remainingSec: null }, 1000)).toEqual([])
    expect(t.update({ found: false, remainingSec: null }, 2500)).toEqual(['disappeared', 'expired'])
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
