import { describe, expect, it } from 'vitest'
import { emptyBank, learn, learnedChars, read, segment } from '../digits'
import { text } from './synth'

describe('digit OCR', () => {
  it('글자를 분리한다', () => {
    expect(segment(text('2:43'), 190)).toHaveLength(4)
  })

  it('학습한 글자로 새 문자열을 읽는다', () => {
    const bank = emptyBank()
    expect(learn(bank, text('12:34'), '12:34').ok).toBe(true)
    expect(learn(bank, text('56:78'), '56:78').ok).toBe(true)
    expect(learn(bank, text('90'), '90').ok).toBe(true)
    expect(learnedChars(bank).join('')).toBe('0123456789:')
    expect(read(bank, text('3:09'))!.text).toBe('3:09')
    expect(read(bank, text('47:15'))!.text).toBe('47:15')
  })

  it('글자 수가 다르면 학습하지 않는다', () => {
    const bank = emptyBank()
    expect(learn(bank, text('2:43'), '2:4').ok).toBe(false)
    expect(bank.samples).toHaveLength(0)
  })
})

describe('밝기 기준 자동 조정', () => {
  it('아이콘의 밝은 테두리가 숫자와 붙어도 기준을 찾아 학습한다', () => {
    const img = text('2:43')
    // 숫자(255)보다 약간 어두운 밝은 테두리(215)를 위/아래에 그린다
    for (const y of [0, img.height - 1]) {
      for (let x = 0; x < img.width; x++) img.data.set([215, 215, 215, 255], (y * img.width + x) * 4)
    }
    const bank = emptyBank()
    bank.threshold = 190
    expect(segment(img, 190).length).toBe(1)
    expect(learn(bank, img, '2:43').ok).toBe(true)
    expect(bank.threshold).toBeGreaterThan(215)
  })
})
