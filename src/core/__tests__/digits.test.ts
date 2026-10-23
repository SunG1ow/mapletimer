import { describe, expect, it } from 'vitest'
import { emptyBank, learn, learnedChars, read, segment } from '../digits'
import { text } from './synth'

describe('digit OCR', () => {
  it('숫자만 분리한다(콜론은 버림)', () => {
    expect(segment(text('2:43'), 190)).toHaveLength(3)
  })

  it('학습한 글자로 새 문자열을 읽는다', () => {
    const bank = { ...emptyBank(), yellowMin: null, threshold: 190 }
    expect(learn(bank, text('12:34'), '12:34').ok).toBe(true)
    expect(learn(bank, text('56:78'), '56:78').ok).toBe(true)
    expect(learn(bank, text('90'), '90').ok).toBe(true)
    expect(learnedChars(bank).join('')).toBe('0123456789')
    expect(read(bank, text('3:09'))!.text).toBe('3:09')
    expect(read(bank, text('47:15'))!.text).toBe('47:15')
  })

  it('콜론 없이 읽은 숫자 개수로 m:ss / ss 를 정한다', () => {
    const bank = { ...emptyBank(), yellowMin: null, threshold: 190 }
    learn(bank, text('12:34'), '12:34')
    learn(bank, text('56:78'), '56:78')
    learn(bank, text('90'), '90')
    expect(read(bank, text('59'))!.text).toBe('59')
    expect(read(bank, text('1:07'))!.text).toBe('1:07')
  })

  it('글자 수가 다르면 학습하지 않는다', () => {
    const bank = { ...emptyBank(), yellowMin: null, threshold: 190 }
    expect(learn(bank, text('2:43'), '2:4').ok).toBe(false)
    expect(bank.samples).toHaveLength(0)
  })
})

// 숫자 바로 옆에 붙은 아이콘 그림의 밝은 세로 줄(밝기만으로는 글자와 한 덩어리가 됨)
// text()는 2배 크기, 글자 사이 1칸 → 'a:bc'에서 b와 c 사이 빈 열은 x=20,21
function withStripe(img: ReturnType<typeof text>, color: number[]) {
  for (let y = 0; y < img.height; y++) for (const x of [20, 21]) img.data.set([...color, 255], (y * img.width + x) * 4)
  return img
}

describe('밝기 기준 자동 조정', () => {
  it('숫자에 붙은 밝은 그림이 있어도 기준을 찾아 학습한다', () => {
    const img = withStripe(text('2:43'), [215, 215, 215]) // '4'와 '3' 사이를 잇는 밝은 회색 줄
    const bank = { ...emptyBank(), yellowMin: null, threshold: 190 }
    expect(segment(img, 190).length).toBe(2)
    expect(learn(bank, img, '2:43').ok).toBe(true)
    expect(bank.threshold).toBeGreaterThan(215)
  })
})

describe('노란 글자 기준', () => {
  it('흰 그림은 밝아도 무시한다', () => {
    const img = withStripe(text('1:07'), [250, 250, 250])
    const bank = emptyBank()
    expect(segment(img, { threshold: 190 }).length).not.toBe(3)
    expect(segment(img, bank).length).toBe(3)
    expect(learn(bank, img, '1:07').ok).toBe(true)
  })

  it('숫자 줄 위아래의 노란 그림 조각은 글자에 넣지 않는다', () => {
    const img = text('59')
    img.data.set([230, 200, 60, 255], 3 * 4) // 맨 윗줄(y=0) 금색 점
    img.data.set([230, 200, 60, 255], 4 * 4)
    const g = segment(img, emptyBank())
    expect(g).toHaveLength(2)
    expect(Math.max(...g.map((x) => x.h))).toBe(10) // 글자 높이(5칸 x 2배)만
  })
})
