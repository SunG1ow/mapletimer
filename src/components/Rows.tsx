// 알림 한 줄씩의 UI.

import { ALERT_BEFORE_MAX, ALERT_BEFORE_MIN, type RuneAlert, type TemplateData, type TimedAlert } from '../config'
import type { TargetStatus } from '../app/engine'
import { formatSec } from '../core/time'

function Toggle(p: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${p.on ? 'on' : ''}`} onClick={() => p.onChange(!p.on)} aria-pressed={p.on}>
      <span />
    </button>
  )
}

function Thumb(p: { list?: TemplateData[]; onAdd: () => void; onClear: () => void; disabled: boolean; addLabel: string }) {
  const list = p.list ?? []
  return (
    <div className="thumb-wrap">
      <button
        className="thumb"
        onClick={p.onAdd}
        disabled={p.disabled}
        title={p.disabled ? '화면 공유를 먼저 시작하세요' : '지금 화면에서 모양 추가'}
      >
        {list.length ? <img src={list[0].png} alt="" className="pixel" /> : <span>등록</span>}
        {list.length > 1 && <em className="badge">{list.length}</em>}
      </button>
      {list.length > 0 && (
        <div className="thumb-actions">
          <button className="link" onClick={p.onAdd} disabled={p.disabled}>
            {p.addLabel}
          </button>
          <button className="link muted" onClick={p.onClear}>
            초기화
          </button>
        </div>
      )}
    </div>
  )
}

function statusText(st: TargetStatus | undefined, hasTemplate: boolean, active: boolean) {
  if (!hasTemplate) return { cls: 'muted', label: '템플릿 없음' }
  if (!active) return { cls: 'muted', label: '대기' }
  if (!st) return { cls: 'muted', label: '…' }
  if (!st.found) return { cls: 'muted', label: `없음 (${st.score.toFixed(2)})` }
  return { cls: 'ok', label: `감지 ${st.score.toFixed(2)}` }
}

function NumberField(p: {
  value: number
  onChange: (v: number) => void
  suffix: string
  min?: number
  max?: number
  width?: number
}) {
  const min = p.min ?? 0
  const max = p.max ?? Infinity
  return (
    <span className="numfield">
      <input
        type="number"
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        value={p.value}
        style={{ width: p.width ?? 56 }}
        onChange={(e) => p.onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
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
  onClear: () => void
  onDelete: () => void
  onTeach: () => void
}) {
  const a = p.alert
  const list = p.profile ? a.templates[p.profile] : undefined
  const tpl = list?.[p.status?.variant ?? 0] ?? list?.[0]
  const st = statusText(p.status, !!tpl, p.active)
  const set = (patch: Partial<TimedAlert>) => p.onChange({ ...a, ...patch })
  const remaining = p.status?.remainingSec
  return (
    <div className={`row ${a.enabled ? '' : 'off'}`}>
      <Toggle on={a.enabled} onChange={(enabled) => set({ enabled })} />
      <Thumb list={list} onAdd={p.onEdit} onClear={p.onClear} disabled={!p.active} addLabel="모양 추가" />
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
        <NumberField
          value={a.alertBeforeSec}
          min={ALERT_BEFORE_MIN}
          max={ALERT_BEFORE_MAX}
          onChange={(alertBeforeSec) => set({ alertBeforeSec })}
          suffix="초 전"
        />
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
  onClear: () => void
}) {
  const r = p.rune
  const list = p.profile ? r.templates[p.profile] : undefined
  const tpl = list?.[0]
  const st = statusText(p.status, !!tpl, p.active)
  const set = (patch: Partial<RuneAlert>) => p.onChange({ ...r, ...patch })
  return (
    <div className={`row ${r.enabled ? '' : 'off'}`}>
      <Toggle on={r.enabled} onChange={(enabled) => set({ enabled })} />
      <Thumb list={list} onAdd={p.onEdit} onClear={p.onClear} disabled={!p.active} addLabel="다른 맵 룬 추가" />
      <div className="row-main">
        <strong>미니맵 룬</strong>
        <div className="row-sub">
          <span className={st.cls}>{st.label}</span>
          {p.status?.found && <span className="warn">룬 있음!</span>}
          {p.active && p.status && (
            <span className="muted">{p.status.minimap ? '미니맵 인식됨' : '미니맵 못 찾음 — 탐색 영역 전체 검사'}</span>
          )}
        </div>
      </div>
      <div className="cell">
        <label>검사 간격</label>
        <NumberField value={r.checkSec} min={1} max={30} onChange={(checkSec) => set({ checkSec })} suffix="초" width={44} />
      </div>
      <div className="cell">
        <label>반복 알림</label>
        <NumberField value={r.repeatSec} onChange={(repeatSec) => set({ repeatSec })} suffix="초마다 (0=한 번)" />
      </div>
      <div className="cell">
        <label>일치 비율 {Math.round(r.matchRatio * 100)}%</label>
        <input
          type="range"
          min={0.4}
          max={0.95}
          step={0.05}
          value={r.matchRatio}
          onChange={(e) => set({ matchRatio: Number(e.target.value) })}
        />
      </div>
      <div className="cell">
        <label>음성</label>
        <input className="speech" value={r.speech} onChange={(e) => set({ speech: e.target.value })} />
      </div>
    </div>
  )
}
