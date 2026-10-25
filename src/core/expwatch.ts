// 사냥 멈춤 감지: 맨 아래 경험치 띠(노란 바 + 경험치 숫자)가 바뀌는지 본다.
// 경험치 바 끝은 몇 분에 1~2px밖에 안 움직이지만(실측 0.1% ≈ 2px), 숫자는 몬스터를 잡을 때마다 바뀐다.
// 띠 위아래와 바 바탕은 반투명이라 뒤의 게임 화면이 비친다. 경험치 아이템의 불꽃·일렁임 효과가 비치면
// 밝기 비교로는 100~2000px이 바뀌어 사냥 중으로 오인했다(실사용 보고). 그래서 흰 숫자와 노란 바 채움만
// 골라 그 모양이 바뀌었는지 본다. 불꽃(주황·빨강)은 둘 다에 걸리지 않는다(실측 0px).

import type { Rgba } from './image'

/** 이만큼 픽셀이 바뀌면 경험치가 바뀐 것으로 본다(스크린샷 사이 숫자 변화는 실측 200px 이상, 바 끝 1px은 8px). */
const MIN_CHANGED_PX = 20

export interface ExpChange {
  changed: boolean
  diffPx: number
}

const NONE = 0
const TEXT = 1
const BAR = 2

/** 픽셀마다 흰 숫자(1) / 노란 바 채움(2) / 그 밖(0). */
function labels(img: Rgba): Uint8Array {
  const out = new Uint8Array(img.width * img.height)
  const d = img.data
  for (let i = 0; i < out.length; i++) {
    const r = d[i * 4]
    const g = d[i * 4 + 1]
    const b = d[i * 4 + 2]
    const mn = Math.min(r, g, b)
    const mx = Math.max(r, g, b)
    if (mn >= 180 && mx - mn <= 50) out[i] = TEXT
    else if (g >= 150 && g >= r && b <= 60) out[i] = BAR
    else out[i] = NONE
  }
  return out
}

export class ExpWatcher {
  private ref: Uint8Array | null = null

  reset() {
    this.ref = null
  }

  /** 기준 띠와 비교한다. 바뀌었으면 기준을 지금 띠로 바꾼다(느린 변화도 쌓이면 잡힌다). */
  update(strip: Rgba): ExpChange {
    const l = labels(strip)
    const ref = this.ref
    if (!ref || ref.length !== l.length) {
      this.ref = l
      return { changed: false, diffPx: 0 }
    }
    let n = 0
    for (let i = 0; i < l.length; i++) if (l[i] !== ref[i]) n++
    const changed = n >= MIN_CHANGED_PX
    if (changed) this.ref = l
    return { changed, diffPx: n }
  }
}
