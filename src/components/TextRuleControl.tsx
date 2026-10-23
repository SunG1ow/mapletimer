// 숫자 글자 판정 기준(노란 글자 / 밝기) 조절.

import { DEFAULT_YELLOW_MIN, type TextRule } from '../core/digits'

export function TextRuleControl(p: { rule: TextRule; onChange: (patch: Partial<TextRule>) => void }) {
  const yellow = p.rule.yellowMin != null
  return (
    <>
      <label>
        숫자 판정{' '}
        <select
          value={yellow ? 'yellow' : 'bright'}
          onChange={(e) => p.onChange({ yellowMin: e.target.value === 'yellow' ? DEFAULT_YELLOW_MIN : null })}
        >
          <option value="yellow">노란 글자</option>
          <option value="bright">밝기</option>
        </select>
      </label>
      {yellow ? (
        <label>
          노란 정도 {p.rule.yellowMin}
          <input
            type="range"
            min={15}
            max={140}
            value={p.rule.yellowMin ?? DEFAULT_YELLOW_MIN}
            onChange={(e) => p.onChange({ yellowMin: Number(e.target.value) })}
          />
        </label>
      ) : (
        <label>
          밝기 기준 {p.rule.threshold}
          <input
            type="range"
            min={80}
            max={250}
            value={p.rule.threshold}
            onChange={(e) => p.onChange({ threshold: Number(e.target.value) })}
          />
        </label>
      )}
    </>
  )
}
