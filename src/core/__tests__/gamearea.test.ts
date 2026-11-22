import { describe, expect, it } from 'vitest'
import { gameArea } from '../image'

describe('gameArea — 창 모드 공유에서 게임 화면만', () => {
  it('제목 표시줄과 테두리를 뺀다', () => {
    expect(gameArea(1922, 1126)).toEqual({ x: 1, y: 45, w: 1920, h: 1080 }) // 노트북 150%, 실사용
    expect(gameArea(1922, 1112)).toEqual({ x: 1, y: 31, w: 1920, h: 1080 }) // 100%
    expect(gameArea(1368, 800)).toEqual({ x: 1, y: 31, w: 1366, h: 768 })
  })

  it('딱 맞거나 게임 화면이 아니면 그대로', () => {
    expect(gameArea(1920, 1080)).toBeNull()
    expect(gameArea(2560, 1600)).toBeNull() // 화면 전체 공유
    expect(gameArea(1700, 1000)).toBeNull()
  })
})
