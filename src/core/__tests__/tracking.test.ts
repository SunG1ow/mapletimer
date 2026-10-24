import { describe, expect, it } from 'vitest'
import { Detector } from '../../detector'
import { emptyBank } from '../digits'
import type { Rgba } from '../image'
import { icon, noise, paste, rng } from './synth'

/** 아이콘 픽셀을 조금 흐트러뜨려 일치도를 낮춘다(실제 화면 vs JPG 템플릿 차이 흉내). */
function jitter(img: Rgba, amount: number, seed: number): Rgba {
  const r = rng(seed)
  const out = { ...img, data: new Uint8ClampedArray(img.data) }
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(0, Math.min(255, out.data[i + c] + (r() - 0.5) * amount))
  }
  return out
}

const tpl = icon(30, 2)
const target = (threshold: number) => ({
  id: 'buff',
  region: { x: 0.5, y: 0, w: 0.5, h: 0.3 },
  variants: [{ rgba: tpl, digitRect: null }],
  method: 'ncc' as const,
  threshold,
})

describe('추적 유지(히스테리시스)', () => {
  const clean = noise(800, 400, 1)
  paste(clean, tpl, 700, 40)
  const rough = noise(800, 400, 1)
  paste(rough, jitter(tpl, 140, 3), 700, 40)

  it('처음 찾을 때는 기준을 넘어야 하지만, 추적 중에는 조금 낮아져도 유지한다', () => {
    const fresh = new Detector()
    fresh.configure({ digitBank: emptyBank(), targets: [target(0.95)] })
    const roughScore = fresh.detect(rough, 0)[0]
    expect(roughScore.score).toBeGreaterThan(0.8)
    expect(roughScore.score).toBeLessThan(0.95)
    expect(roughScore.found).toBe(false)

    const d = new Detector()
    d.configure({ digitBank: emptyBank(), targets: [target(0.95)] })
    expect(d.detect(clean, 0)[0].found).toBe(true)
    expect(d.detect(rough, 250)[0].found).toBe(true)
  })
})
