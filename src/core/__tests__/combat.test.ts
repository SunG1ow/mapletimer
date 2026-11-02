import { describe, expect, it } from 'vitest'
import { Detector, type TargetSpec } from '../../detector'
import { emptyBank } from '../digits'
import { CombatTracker } from '../trackers'
import { icon, noise, paste, text } from './synth'
import type { Rgba } from '../image'

describe('CombatTracker', () => {
  it('무아가 마지막으로 보인 뒤 (전투 유지 − 무아 유지 − 알림 시점)초에 알리고, 다시 보이면 처음부터', () => {
    const t = new CombatTracker({ keepSec: 14, buffSec: 5, alertBeforeSec: 3 })
    const ev: string[] = []
    for (let ms = 0; ms <= 30000; ms += 250) {
      const seen = ms <= 2000 || (ms >= 20000 && ms <= 21000) // 2초까지 공격, 20~21초에 다시 공격
      ev.push(...t.update(seen, ms).map((e) => `${ms}:${e}`))
    }
    // 마지막으로 본 2초 + 9초 = 11초에 끊김 → 8초에 알림. 21초 + 9 = 30초 → 27초에 알림
    expect(ev).toEqual(['8000:alert', '11000:ended', '27000:alert', '30000:ended'])
  })

  it('보이는 동안·한 번도 못 봤을 때는 울리지 않는다', () => {
    const t = new CombatTracker({ keepSec: 14, buffSec: 5, alertBeforeSec: 3 })
    for (let ms = 0; ms < 60000; ms += 500) expect(t.update(false, ms)).toEqual([])
    for (let ms = 60000; ms < 120000; ms += 500) expect(t.update(true, ms)).toEqual([])
    expect(t.remainingSec(120000)).toBeCloseTo(9 - 0.5, 1)
  })
})

/** 무아 흉내: 아이콘 + 오른쪽 아래 스택 숫자(1~5) */
const base = icon(28, 4)
function muaIcon(stack: number): Rgba {
  const img = { ...base, data: new Uint8ClampedArray(base.data) }
  paste(img, text(String(stack), 2), 18, 14)
  return img
}
const DIGIT_RECT = { x: 18, y: 14, w: 10, h: 14 }

describe('무아 감지(생겼다 사라짐 반복, 시간 표시 없음)', () => {
  it('위치가 바뀌고 스택 숫자가 바뀌고 끝무렵 깜빡여도, 보이는 동안 잡고 사라진 순간을 0.5초 안에 안다', () => {
    const W = 960
    const H = 540
    // 옆 칸의 다른 즐겨찾기 버프(야누스 등). 합성 icon()끼리는 모양이 거의 같아 실제와 달리 서로 맞으므로 무늬로 대신한다.
    const others = [11, 12, 13].map((seed) => noise(28, 28, seed, 255))
    const mua: TargetSpec = {
      id: 'combat',
      region: { x: 0, y: 0, w: 1, h: 1 },
      variants: [{ rgba: muaIcon(5), digitRect: DIGIT_RECT, readDigits: false }],
      method: 'ncc',
      threshold: 0.8,
      rescanMs: 2000,
    }
    // 화면에 없는 버프 3개가 전체 탐색 순서를 다툰다(실제로도 꺼진 도핑이 여러 개일 수 있다).
    const absent: TargetSpec[] = [7, 8, 9].map((h) => ({
      id: `absent${h}`,
      region: { x: 0, y: 0, w: 1, h: 1 },
      variants: [{ rgba: icon(28, h * 25), digitRect: null }],
      method: 'ncc',
      threshold: 0.8,
    }))
    const d = new Detector()
    d.configure({ digitBank: emptyBank(), targets: [mua, ...absent] })

    // 공격 구간: [시작, 끝(ms)], 그때 무아가 놓인 즐겨찾기 칸 x 위치
    const bursts = [
      { from: 1000, to: 4000, x: 800 },
      { from: 15000, to: 15300, x: 760 }, // 한 번만 때림: 아이콘은 5초만 보인다
      { from: 30000, to: 33000, x: 840 }, // 즐겨찾기 순서가 바뀌어 다른 칸
    ]
    const BUFF_MS = 5000
    const bg = noise(W, H, 5, 80)
    const lastSeenAt: number[] = bursts.map(() => -1)
    for (let now = 0; now <= 45000; now += 250) {
      const frame = { ...bg, data: new Uint8ClampedArray(bg.data) }
      others.forEach((o, i) => paste(frame, o, 650 + i * 32, 480))
      bursts.forEach((b, i) => {
        if (now < b.from || now > b.to + BUFF_MS) return
        const stack = Math.min(5, 1 + Math.floor((now - b.from) / 600))
        const left = b.to + BUFF_MS - now
        if (left < 2000 && Math.floor(now / 250) % 2 === 1) return // 끝 2초 깜빡임
        paste(frame, muaIcon(stack), b.x, 480)
        void i
      })
      const r = d.detect(frame, now).find((x) => x.id === 'combat')!
      if (r.found) {
        const i = bursts.findIndex((b) => now >= b.from && now <= b.to + BUFF_MS)
        expect(i, `${now}ms 엉뚱한 곳에서 감지`).toBeGreaterThanOrEqual(0)
        lastSeenAt[i] = now
      }
    }
    bursts.forEach((b, i) => {
      const end = b.to + BUFF_MS
      expect(lastSeenAt[i], `구간 ${i}를 놓침`).toBeGreaterThan(0)
      expect(end - lastSeenAt[i], `구간 ${i}의 사라진 시각 오차`).toBeLessThanOrEqual(500)
    })
  }, 60000)
})
