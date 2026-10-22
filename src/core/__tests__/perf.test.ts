import { expect, it } from 'vitest'
import { Detector } from '../../detector'
import { emptyBank } from '../digits'
import { icon, noise, paste } from './synth'

it('1920x1080 프레임 전체 감지가 충분히 빠르다', () => {
  const frame = noise(1920, 1080, 11)
  const janus = icon(32, 1)
  const buffs = [2, 3, 4, 5, 6].map((h) => icon(30, h))
  const rune = icon(10, 7)
  paste(frame, janus, 1500, 900)
  buffs.forEach((b, i) => paste(frame, b, 1700 + i * 32, 40))
  paste(frame, rune, 120, 140)
  const d = new Detector()
  d.configure({
    threshold: 0.8,
    digitBank: emptyBank(),
    targets: [
      { id: 'janus', region: { x: 0, y: 0, w: 1, h: 1 }, rgba: janus, digitRect: null },
      ...buffs.map((b, i) => ({ id: `b${i}`, region: { x: 0.5, y: 0, w: 0.5, h: 0.3 }, rgba: b, digitRect: null })),
      { id: 'rune', region: { x: 0, y: 0, w: 0.35, h: 0.45 }, rgba: rune, digitRect: null },
    ],
  })
  let t0 = performance.now()
  const first = d.detect(frame)
  const cold = performance.now() - t0
  t0 = performance.now()
  d.detect(frame)
  const warm = performance.now() - t0
  console.log(`cold ${cold.toFixed(0)}ms, warm ${warm.toFixed(0)}ms`)
  expect(first.every((r) => r.found)).toBe(true)
  expect(first.find((r) => r.id === 'janus')).toMatchObject({ x: 1500, y: 900 })
  expect(first.find((r) => r.id === 'rune')).toMatchObject({ x: 120, y: 140 })
  expect(warm).toBeLessThan(150)
})
