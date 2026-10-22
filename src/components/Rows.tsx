// 알림 한 줄씩의 UI.

import type { RuneAlert, TimedAlert } from '../config'
import type { TargetStatus } from '../app/engine'
import { formatSec } from '../core/time'

function Toggle(p: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${p.on ? 'on' : ''}`} onClick={() => p.onChange(!p.on)} aria-pressed={p.on}>
      <span />
    </button>
  )
}

function Thumb(p: { png?: string; onEdit: () => void; disabled: boolean }) {
  return (
    <button
      className="thumb"
      onClick={p.onEdit}
      disabled={p.disabled}
      title={p.disabled ? '화면 공유를 먼저 시작하세요' : '화면에서 아이콘 등록'}
    >
      {p.png ? <img src={p.png} alt="" className="pixel" /> : <span>등록</span>}
    </button>
  )
}

function statusText(st: TargetStatus | undefined, hasTemplate: boolean, active: boolean) {
  if (!hasTemplate) return { cls: 'muted', label: '템플릿 없음' }
  if (!active) return { cls: 'muted', label: '대기' }
  if (!st) return { cls: 'muted', label: '…' }
  if (!st.found) return { cls: 'muted', label: `없음 (${st.score.toFixed(2)})` }
  return { cls: 'ok', label: `감지 ${st.score.toFixed(2)}` }
}

function NumberField(p: { value: number; onChange: (v: number) => void; suffix: string; min?: number; width?: number }) {
  return (
    <span className="numfield">
      <input
        type="number"
        min={p.min ?? 0}
        value={p.value}
        style={{ width: p.width ?? 56 }}
        onChange={(e) => p.onChange(Math.max(p.min ?? 0, Number(e.target.value) || 0))}
      />
      {p.suffix}
    </span>
  )
}

export function TimedRow(p: {
  alert: TimedAlert
  profile: string | null
  status?: TargetStatus
  active: boolean
  onChange: (a: TimedAlert) => void
  onEdit: () => void
  onDelete: () => void
  onTeach: () => void
}) {
  const a = p.alert
  const tpl = p.profile ? a.templates[p.profile] : undefined
  const st = statusText(p.status, !!tpl, p.active)
  const set = (patch: Partial<TimedAlert>) => p.onChange({ ...a, ...patch })
  const remaining = p.status?.remainingSec
  return (
    <div className={`row ${a.enabled ? '' : 'off'}`}>
      <Toggle on={a.enabled} onChange={(enabled) => set({ enabled })} />
      <Thumb png={tpl?.png} onEdit={p.onEdit} disabled={!p.active} />
      <div className="row-main">
        <input className="name" value={a.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="row-sub">
          <span className={st.cls}>{st.label}</span>
          {p.status?.text != null && <span className="ocr">읽음 “{p.status.text}”</span>}
          {p.status?.lastEvent === 'refreshed' && <span className="ok">갱신됨</span>}
          {tpl?.digitRect && p.status?.digitCrop && (
            <button className="link" onClick={p.onTeach}>
              숫자 가르치기
            </button>
          )}
        </div>
      </div>
      <div className="cell">
        <label>남은 시간</label>
        <strong className={remaining != null && remaining <= a.alertBeforeSec ? 'warn' : ''}>
          {remaining != null ? formatSec(remaining) : '--'}
        </strong>
      </div>
      <div className="cell">
        <label>알림 시점</label>
        <NumberField value={a.alertBeforeSec} onChange={(alertBeforeSec) => set({ alertBeforeSec })} suffix="초 전" />
      </div>
      <div className="cell">
        <label>시간 기준</label>
        <select value={a.mode} onChange={(e) => set({ mode: e.target.value as TimedAlert['mode'] })}>
          <option value="ocr">아이콘 숫자 인식</option>
          <option value="appear">아이콘 등장 후 고정 시간</option>
        </select>
        {a.mode === 'appear' ? (
          <NumberField value={a.durationSec} onChange={(durationSec) => set({ durationSec })} suffix="초 지속" min={1} />
        ) : (
          <select value={a.colonUnit} onChange={(e) => set({ colonUnit: e.target.value as TimedAlert['colonUnit'] })}>
            <option value="ms">a:b = 분:초</option>
            <option value="hm">a:b = 시:분</option>
          </select>
        )}
      </div>
      <div className="cell">
        <label>
          <input type="checkbox" checked={a.alertOnExpire} onChange={(e) => set({ alertOnExpire: e.target.checked })} />{' '}
          사라지면 알림
        </label>
        <input
          className="speech"
          placeholder={`음성: ${a.name}`}
          value={a.speech}
          onChange={(e) => set({ speech: e.target.value })}
        />
      </div>
      <button className="icon-btn" onClick={p.onDelete} title="삭제">
        ✕
      </button>
    </div>
  )
}

export function RuneRow(p: {
  rune: RuneAlert
  profile: string | null
  status?: TargetStatus
  active: boolean
  onChange: (r: RuneAlert) => void
  onEdit: () => void
}) {
  const r = p.rune
  const tpl = p.profile ? r.templates[p.profile] : undefined
  const st = statusText(p.status, !!tpl, p.active)
  const set = (patch: Partial<RuneAlert>) => p.onChange({ ...r, ...patch })
  return (
    <div className={`row ${r.enabled ? '' : 'off'}`}>
      <Toggle on={r.enabled} onChange={(enabled) => set({ enabled })} />
      <Thumb png={tpl?.png} onEdit={p.onEdit} disabled={!p.active} />
      <div className="row-main">
        <strong>미니맵 룬</strong>
        <div className="row-sub">
          <span className={st.cls}>{st.label}</span>
          {p.status?.found && <span className="warn">룬 있음!</span>}
        </div>
      </div>
      <div className="cell">
        <label>반복 알림</label>
        <NumberField value={r.repeatSec} onChange={(repeatSec) => set({ repeatSec })} suffix="초마다 (0=한 번)" />
      </div>
      <div className="cell">
        <label>음성</label>
        <input className="speech" value={r.speech} onChange={(e) => set({ speech: e.target.value })} />
      </div>
    </div>
  )
}
