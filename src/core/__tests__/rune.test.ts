import { describe, expect, it } from 'vitest'
import { cropRgba, makeRgba, type Rgba } from '../image'
import { findShape, foregroundMask, prepareShape } from '../match'
import { rng } from './synth'

// 미니맵 흉내: 맵마다 다른 배경색 + 발판 선
function minimap(seed: number, w = 300, h = 160): Rgba {
  const r = rng(seed)
  const img = makeRgba(w, h)
  const base = [r() * 60, r() * 60, r() * 80]
  for (let i = 0; i < w * h; i++) {
    img.data.set([base[0] + r() * 15, base[1] + r() * 15, base[2] + r() * 15, 255], i * 4)
  }
  for (let k = 0; k < 8; k++) {
    const y = Math.floor(r() * h)
    const x0 = Math.floor(r() * w * 0.6)
    for (let x = x0; x < x0 + 80 && x < w; x++) img.data.set([170, 170, 150, 255], (y * w + x) * 4)
  }
  return img
}

function dot(img: Rgba, cx: number, cy: number, color: number[], rad = 3) {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad + 1) img.data.set([...color, 255], (y * img.width + x) * 4)
    }
  }
}

// 룬: 보라색 마름모 + 흰 테두리 점 (배경 투명)
function drawRune(img: Rgba, x0: number, y0: number) {
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const d = Math.abs(x - 5) + Math.abs(y - 5)
      if (d > 5) continue
      const c = d === 5 ? [255, 255, 255] : d <= 1 ? [255, 220, 255] : [190, 90, 240]
      img.data.set([...c, 255], ((y0 + y) * img.width + x0 + x) * 4)
    }
  }
}

const YELLOW = [230, 250, 80]
const RED = [150, 65, 95]
const CYAN = [80, 220, 255]

describe('룬 탐지 (맵 무관, 가림 허용)', () => {
  // 맵 A에서 룬 주변을 조금 넉넉하게 잘라 등록
  const mapA = minimap(1)
  drawRune(mapA, 100, 60)
  const tpl = cropRgba(mapA, { x: 98, y: 58, w: 15, h: 15 })
  const shape = prepareShape(tpl, foregroundMask(tpl, 40))

  it('배경은 비교에서 빠진다', () => {
    expect(shape.idx.length).toBeGreaterThan(40)
    expect(shape.idx.length).toBeLessThan(15 * 15 * 0.6)
  })

  it('다른 맵(배경)에서도 찾는다', () => {
    const mapB = minimap(2)
    drawRune(mapB, 210, 30)
    const m = findShape(mapB, shape)!
    expect([m.x + 2, m.y + 2]).toEqual([210, 30])
    expect(m.score).toBeGreaterThan(0.95)
  })

  it('플레이어 점이 일부를 가려도 찾는다', () => {
    const map = minimap(3)
    drawRune(map, 150, 80)
    dot(map, 152, 83, YELLOW) // 본인 캐릭터 점이 룬 일부를 덮음
    const m = findShape(map, shape)!
    expect([m.x + 2, m.y + 2]).toEqual([150, 80])
    expect(m.score).toBeGreaterThan(0.65)
  })

  it('두 명(본인+다른 사람)이 겹쳐 가려도 찾는다', () => {
    const map = minimap(5)
    drawRune(map, 150, 80)
    dot(map, 151, 82, YELLOW)
    dot(map, 159, 88, RED)
    const m = findShape(map, shape)!
    expect([m.x + 2, m.y + 2]).toEqual([150, 80])
    expect(m.score).toBeGreaterThan(0.65)
  })

  it('룬이 거의 다 가려지면 근거 부족으로 찾지 않는다', () => {
    const map = minimap(6)
    drawRune(map, 150, 80)
    dot(map, 155, 85, YELLOW, 6)
    expect(findShape(map, shape)?.score ?? 0).toBeLessThan(0.65)
  })

  it('룬이 없으면 플레이어 점이 많아도 찾지 않는다', () => {
    const map = minimap(4)
    const r = rng(9)
    for (let k = 0; k < 15; k++) dot(map, 10 + Math.floor(r() * 280), 10 + Math.floor(r() * 140), [YELLOW, RED, CYAN][k % 3])
    const m = findShape(map, shape)
    expect(m?.score ?? 0).toBeLessThan(0.65)
  })
})
