import { describe, expect, it } from 'vitest'
import { ExpWatcher } from '../expwatch'
import { HuntStopTracker } from '../trackers'
import { noise, text } from './synth'
import { makeRgba, type Rgba } from '../image'

/** 맨 아래 띠 흉내: 어두운 바탕 + 왼쪽 노란 경험치 바 + 가운데 경험치 숫자 */
function strip(expText: string, barPx: number): Rgba {
  const img = makeRgba(600, 14)
  for (let i = 0; i < img.width * img.height; i++) img.data.set([30, 30, 34, 255], i * 4)
  for (let y = 4; y < 12; y++) for (let x = 0; x < barPx; x++) img.data.set([200, 230, 40, 255], (y * img.width + x) * 4)
  const t = text(expText, 2, noise(60, 14, 3, 20))
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) img.data.set(t.data.subarray((y * t.width + x) * 4, (y * t.width + x) * 4 + 4), (y * img.width + 260 + x) * 4)
  }
  return img
}

describe('ExpWatcher', () => {
  it('경험치 숫자가 바뀌면 변화, 그대로면 변화 없음', () => {
    const w = new ExpWatcher()
    expect(w.update(strip('1234', 200)).changed).toBe(false) // 첫 기준
    expect(w.update(strip('1234', 200)).changed).toBe(false)
    expect(w.update(strip('1267', 200)).changed).toBe(true) // 실제로는 몬스터 하나에 여러 자리가 바뀐다(실측 500px 이상)
    expect(w.update(strip('1267', 200)).changed).toBe(false)
  })

  it('바 끝이 1px 늘어난 정도의 잡음은 변화로 보지 않는다', () => {
    const w = new ExpWatcher()
    w.update(strip('1234', 200))
    expect(w.update(strip('1234', 201)).changed).toBe(false)
  })
})

describe('HuntStopTracker', () => {
  it('변화가 멈추고 stopSec 뒤 알림, repeatSec마다 반복, 다시 변하면 재개', () => {
    const t = new HuntStopTracker({ stopSec: 10, repeatSec: 5 })
    const ev: string[] = []
    for (let s = 0; s <= 40; s++) {
      const changed = s < 8 ? s % 2 === 0 : s >= 30 // 0~7초 사냥, 8~29초 멈춤, 30초부터 재개
      ev.push(...t.update(changed, s * 1000).map((e) => `${s}:${e}`))
    }
    // 마지막 변화 6초 → 16초에 첫 알림, 이후 5초마다
    expect(ev).toEqual(['16:stopped', '21:stopped', '26:stopped', '30:resumed'])
  })

  it('공유를 막 시작했을 때는 바로 울리지 않는다', () => {
    const t = new HuntStopTracker({ stopSec: 10, repeatSec: 5 })
    expect(t.update(false, 0)).toEqual([])
    expect(t.update(false, 9000)).toEqual([])
    expect(t.update(false, 10000)).toEqual(['stopped'])
  })
})
