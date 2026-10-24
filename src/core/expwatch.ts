// 사냥 멈춤 감지: 맨 아래 경험치 띠(노란 바 + 경험치 숫자)가 바뀌는지 본다.
// 경험치 바 끝은 몇 분에 1~2px밖에 안 움직이지만(실측 0.1% ≈ 2px), 숫자는 몬스터를 잡을 때마다 바뀐다.

import { toGray, type Gray, type Rgba } from './image'

/** 픽셀 하나가 바뀐 것으로 볼 밝기 차이 */
const PIXEL_DIFF = 40
/** 이만큼 픽셀이 바뀌면 경험치가 바뀐 것으로 본다(스크린샷 사이 숫자 변화는 실측 500px 이상, 잡음은 0~8px). */
const MIN_CHANGED_PX = 20

export interface ExpChange {
  changed: boolean
  diffPx: number
}

export class ExpWatcher {
  private ref: Gray | null = null

  reset() {
    this.ref = null
  }

  /** 기준 띠와 비교한다. 바뀌었으면 기준을 지금 띠로 바꾼다(느린 변화도 쌓이면 잡힌다). */
  update(strip: Rgba): ExpChange {
    const g = toGray(strip)
    const ref = this.ref
    if (!ref || ref.width !== g.width || ref.height !== g.height) {
      this.ref = g
      return { changed: false, diffPx: 0 }
    }
    let n = 0
    for (let i = 0; i < g.data.length; i++) if (Math.abs(g.data[i] - ref.data[i]) > PIXEL_DIFF) n++
    const changed = n >= MIN_CHANGED_PX
    if (changed) this.ref = g
    return { changed, diffPx: n }
  }
}
