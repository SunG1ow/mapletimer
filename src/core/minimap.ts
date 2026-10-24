// 좌상단 미니맵 창 찾기. 미니맵 크기는 맵마다 달라 고정 영역으로 잡으면 게임 화면 속 비슷한 장식
// (예: 밤의 길의 보라색 마름모)을 룬으로 오인한다. 미니맵의 밝은 둥근 테두리를 찾아 그 안만 본다.

import type { Rect, Rgba } from './image'

interface Run {
  y: number
  x0: number
  x1: number // 끝(포함)
}

const MIN_WIDTH = 80
const MIN_HEIGHT = 30

/** 흰색/밝은 회색 테두리 픽셀 */
function isBorder(d: Uint8ClampedArray, i: number): boolean {
  const r = d[i]
  const g = d[i + 1]
  const b = d[i + 2]
  const lo = Math.min(r, g, b)
  return lo > 150 && Math.max(r, g, b) - lo < 50
}

/** 각 행에서 가장 긴 밝은 가로 구간(2px 이하 끊김 허용). */
function longestRun(img: Rgba, area: Rect, y: number): Run | null {
  let best: Run | null = null
  let start = -1
  let gap = 0
  let last = -1
  for (let x = area.x; x < area.x + area.w; x++) {
    if (isBorder(img.data, (y * img.width + x) * 4)) {
      if (start < 0) start = x
      last = x
      gap = 0
    } else if (start >= 0 && ++gap > 2) {
      if (!best || last - start > best.x1 - best.x0) best = { y, x0: start, x1: last }
      start = -1
    }
  }
  if (start >= 0 && (!best || last - start > best.x1 - best.x0)) best = { y, x0: start, x1: last }
  return best
}

function sideCoverage(img: Rgba, x: number, y0: number, y1: number): number {
  let on = 0
  for (let y = y0; y <= y1; y++) {
    let hit = false
    for (let dx = -2; dx <= 2 && !hit; dx++) {
      const xx = x + dx
      if (xx >= 0 && xx < img.width && isBorder(img.data, (y * img.width + xx) * 4)) hit = true
    }
    if (hit) on++
  }
  return on / Math.max(1, y1 - y0 + 1)
}

/** area(픽셀) 안에서 미니맵 테두리 안쪽 영역을 찾는다. 못 찾으면 null. */
export function findMinimap(img: Rgba, area: Rect): Rect | null {
  const rows: Run[] = []
  for (let y = area.y; y < area.y + area.h; y++) {
    const r = longestRun(img, area, y)
    if (r && r.x1 - r.x0 + 1 >= MIN_WIDTH) rows.push(r)
  }
  let best: Rect | null = null
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const t = rows[i]
      const b = rows[j]
      if (b.y - t.y < MIN_HEIGHT) continue
      // 둥근 모서리 때문에 위/아래 구간 끝이 조금 다를 수 있다.
      if (Math.abs(t.x0 - b.x0) > 6 || Math.abs(t.x1 - b.x1) > 6) continue
      const x0 = Math.min(t.x0, b.x0)
      const x1 = Math.max(t.x1, b.x1)
      // 세로 테두리는 모서리 둥근 부분을 빼고 확인
      if (sideCoverage(img, x0, t.y + 4, b.y - 4) < 0.7 || sideCoverage(img, x1, t.y + 4, b.y - 4) < 0.7) continue
      const rect = { x: x0 + 2, y: t.y + 2, w: x1 - x0 - 3, h: b.y - t.y - 3 }
      // 가장 위에 있는 것 중 가장 큰 것(테두리 두께 때문에 2px 겹쳐 찾히는 쌍은 큰 쪽으로)
      if (!best || rect.w * rect.h > best.w * best.h) best = rect
    }
    if (best) break
  }
  return best
}

/** 내 캐릭터 점(노랑) 색. 실제 게임 화면에서 측정. */
const SELF_DOT = [230, 250, 80]
const SELF_DOT_TOL = 45

/**
 * 미니맵 안에 내 캐릭터 점(노란 원)이 보이는지. 미니맵에는 항상 내 점이 있으므로, 없으면 이벤트 창 같은
 * 다른 창이 미니맵을 가렸거나 미니맵이 아닌 사각형을 잘못 찾은 것이다(실사용에서 이벤트 창을 열 때 룬 오탐).
 */
export function hasSelfDot(img: Rgba, r: Rect): boolean {
  let n = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4
      if (
        Math.abs(img.data[i] - SELF_DOT[0]) <= SELF_DOT_TOL &&
        Math.abs(img.data[i + 1] - SELF_DOT[1]) <= SELF_DOT_TOL &&
        Math.abs(img.data[i + 2] - SELF_DOT[2]) <= SELF_DOT_TOL &&
        ++n >= 4
      )
        return true
    }
  }
  return false
}
