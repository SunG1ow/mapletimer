// 아이콘 숫자 문자열을 초 단위로 바꾼다.

/** 'ms' = "a:b"를 분:초로, 'hm' = 시:분으로 해석. */
export type ColonUnit = 'ms' | 'hm'
/** 콜론 없는 숫자 하나의 단위. */
export type PlainUnit = 's' | 'm'

export function parseRemaining(text: string, colon: ColonUnit = 'ms', plain: PlainUnit = 's'): number | null {
  if (!/^\d+(:\d+){0,2}$/.test(text)) return null
  // 메이플 아이콘은 1분 미만이면 '12'처럼 초만 보여 주고 앞자리 0을 쓰지 않는다. '0:12', '05'는 오독(예: 6→0).
  if (/^0\d/.test(text.replace(':', '')) && text !== '0') return null
  const parts = text.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) {
    if (parts[1] >= 60) return null
    return colon === 'ms' ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60
  }
  return plain === 's' ? parts[0] : parts[0] * 60
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}
