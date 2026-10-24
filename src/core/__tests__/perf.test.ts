import { expect, it } from 'vitest'
import { Detector } from '../../detector'
import { emptyBank } from '../digits'
import type { Rgba } from '../image'
import { icon, noise, paste } from './synth'

const ncc = (rgba: Rgba) => ({ variants: [{ rgba, digitRect: null }], method: 'ncc' as const, threshold: 0.8 })

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
    digitBank: emptyBank(),
    targets: [
      { id: 'janus', region: { x: 0, y: 0, w: 1, h: 1 }, ...ncc(janus) },
      ...buffs.map((b, i) => ({ id: `b${i}`, region: { x: 0.5, y: 0, w: 0.5, h: 0.3 }, ...ncc(b) })),
      {
        id: 'rune',
        region: { x: 0, y: 0, w: 0.35, h: 0.45 },
        variants: [{ rgba: rune, digitRect: null, bgTolerance: 40 }],
        method: 'shape' as const,
        threshold: 0.65,
      },
    ],
  })
  // 한 프레임의 전체 탐색은 1번으로 제한되므로 처음 몇 프레임(4fps 기준 3초 안)에 걸쳐 모두 찾는다.
  let t0 = performance.now()
  const latest = new Map<string, ReturnType<typeof d.detect>[number]>()
  for (let k = 0; k < 12; k++) for (const r of d.detect(frame, k * 250)) latest.set(r.id, r)
  const first = [...latest.values()]
  const cold = performance.now() - t0
  t0 = performance.now()
  d.detect(frame, 3500)
  const warm = performance.now() - t0
  console.log(`cold ${cold.toFixed(0)}ms, warm ${warm.toFixed(0)}ms`)
  expect(first.every((r) => r.found)).toBe(true)
  expect(first.find((r) => r.id === 'janus')).toMatchObject({ x: 1500, y: 900 })
  expect(first.find((r) => r.id === 'rune')).toMatchObject({ x: 120, y: 140 })
  expect(warm).toBeLessThan(150)
})
