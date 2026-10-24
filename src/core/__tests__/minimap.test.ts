import { describe, expect, it } from 'vitest'
import { defaultSettings, resolveProfile } from '../../config'
import { groupText } from '../../app/engine'
import { makeRgba } from '../image'
import { findMinimap, hasSelfDot } from '../minimap'
import { noise } from './synth'

function drawMinimap(x0: number, y0: number, w: number, h: number) {
  const img = noise(600, 400, 2, 60)
  const px = (x: number, y: number) => img.data.set([230, 230, 230, 255], (y * img.width + x) * 4)
  for (let x = x0 + 3; x <= x0 + w - 3; x++) for (const y of [y0, y0 + 1, y0 + h - 1, y0 + h]) px(x, y)
  for (let y = y0 + 3; y <= y0 + h - 3; y++) for (const x of [x0, x0 + 1, x0 + w - 1, x0 + w]) px(x, y)
  // 미니맵 아래 게임 화면의 밝은 글자(짧은 가로획들)
  for (let k = 0; k < 6; k++) for (let x = 20 + k * 40; x < 50 + k * 40; x++) px(x, y0 + h + 30)
  return img
}

describe('findMinimap', () => {
  it('밝은 테두리 안쪽 영역을 찾는다', () => {
    const r = findMinimap(drawMinimap(7, 68, 190, 77), { x: 0, y: 0, w: 600, h: 400 })!
    expect(r.x).toBeGreaterThanOrEqual(8)
    expect(r.x).toBeLessThanOrEqual(12)
    expect(r.y).toBeGreaterThanOrEqual(69)
    expect(r.x + r.w).toBeGreaterThan(190)
    expect(r.y + r.h).toBeGreaterThan(140)
  })

  it('테두리가 없으면 null', () => {
    expect(findMinimap(noise(300, 200, 3, 60), { x: 0, y: 0, w: 300, h: 200 })).toBeNull()
    expect(findMinimap(makeRgba(300, 200), { x: 0, y: 0, w: 300, h: 200 })).toBeNull()
  })
})

describe('hasSelfDot (미니맵이 가려졌는지)', () => {
  it('내 캐릭터 노란 점이 있으면 진짜 미니맵, 없으면 다른 창이 가린 것', () => {
    const img = drawMinimap(7, 68, 190, 77)
    const r = findMinimap(img, { x: 0, y: 0, w: 600, h: 400 })!
    expect(hasSelfDot(img, r)).toBe(false) // 이벤트 창처럼 테두리만 있는 사각형
    for (let y = 110; y < 116; y++) for (let x = 60; x < 66; x++) img.data.set([228, 248, 84, 255], (y * img.width + x) * 4)
    expect(hasSelfDot(img, r)).toBe(true)
  })
})

describe('resolveProfile', () => {
  it('정확한 크기가 없으면 ±64px 안의 가까운 프로필', () => {
    const s = defaultSettings()
    s.profiles['1920x1080'] = { digitBank: { threshold: 220, samples: [] } }
    expect(resolveProfile(s, 1920, 1080)).toBe('1920x1080')
    expect(resolveProfile(s, 1922, 1112)).toBe('1920x1080')
    expect(resolveProfile(s, 1366, 768)).toBe('1366x768')
  })
})

describe('groupText', () => {
  it('여러 버프 알림을 한 문장으로', () => {
    expect(groupText(['도핑'], '20초 전')).toBe('도핑 20초 전')
    expect(groupText(['A', 'B'], '종료')).toBe('A, B 종료')
    expect(groupText(['경험치 쿠폰', 'B', 'C', 'D'], '20초 전')).toBe('경험치 쿠폰 외 3개 20초 전')
  })
})
