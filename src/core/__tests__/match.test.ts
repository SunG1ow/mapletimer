import { describe, expect, it } from 'vitest'
import { cropRgba } from '../image'
import { findTemplate, prepareTemplate } from '../match'
import { icon, noise, paste, text } from './synth'

describe('findTemplate', () => {
  it('찾는 아이콘의 위치를 정확히 찾는다', () => {
    const frame = noise(480, 270, 3)
    const a = icon(28, 1)
    const b = icon(28, 2)
    paste(frame, b, 100, 100)
    paste(frame, a, 401, 37)
    const m = findTemplate(frame, prepareTemplate(a))!
    expect(m.x).toBe(401)
    expect(m.y).toBe(37)
    expect(m.score).toBeGreaterThan(0.95)
  })

  it('없는 아이콘은 낮은 점수', () => {
    const frame = noise(300, 200, 5)
    paste(frame, icon(28, 2), 50, 50)
    const m = findTemplate(frame, prepareTemplate(icon(28, 4)))
    expect(m?.score ?? 0).toBeLessThan(0.8)
  })

  it('숫자 영역을 제외하면 숫자가 달라도 찾는다', () => {
    const tpl = icon(32, 3)
    paste(tpl, text('2:43'), 2, 18)
    const live = icon(32, 3)
    paste(live, text('1:07'), 2, 18)
    const frame = noise(400, 300, 9)
    paste(frame, live, 222, 155)
    const digitRect = { x: 2, y: 18, w: 28, h: 14 }
    const m = findTemplate(frame, prepareTemplate(tpl, digitRect))!
    expect([m.x, m.y]).toEqual([222, 155])
    expect(m.score).toBeGreaterThan(0.95)
    expect(cropRgba(frame, { x: m.x, y: m.y, w: 32, h: 32 }).width).toBe(32)
  })
})
