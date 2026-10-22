import { useEffect, useMemo, useRef, useState } from 'react'
import { Capture } from './app/capture'
import { Engine, RUNE_ID, type EngineSnapshot } from './app/engine'
import { beep, speak, unlockAudio } from './app/sound'
import { exportSettings, useSettings } from './app/store'
import { decodePng, rgbaToDataUrl } from './app/templates'
import {
  newTimedAlert,
  profileKey,
  type Regions,
  type Settings,
  type TemplateData,
  type Templates,
  type TimedGroup,
} from './config'
import { emptyBank, findThreshold, learn, learnedChars, segment, type DigitBank } from './core/digits'
import { cropRgba, type Rect, type Rgba } from './core/image'
import type { TargetSpec } from './detector'
import { RuneRow, TimedRow } from './components/Rows'
import { TemplateEditor, type EditorResult } from './components/TemplateEditor'

type EditorTarget = { id: string; title: string; withDigits: boolean; snapshot: HTMLCanvasElement }

function bankOf(s: Settings, profile: string | null): DigitBank {
  return (profile && s.profiles[profile]?.digitBank) || emptyBank()
}

function withBank(s: Settings, profile: string, fn: (b: DigitBank) => DigitBank): Settings {
  const bank = fn(structuredClone(bankOf(s, profile)))
  return { ...s, profiles: { ...s.profiles, [profile]: { ...s.profiles[profile], digitBank: bank } } }
}

export default function App() {
  const [settings, update, replace] = useSettings()
  const [active, setActive] = useState(false)
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)
  const [snap, setSnap] = useState<EngineSnapshot | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [teach, setTeach] = useState<{ id: string; crop: Rgba } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const profile = frame ? profileKey(frame.w, frame.h) : null
  const bank = bankOf(settings, profile)

  const [engine] = useState(() => new Engine(settings))

  const captureRef = useRef<Capture | null>(null)
  const capture = () =>
    (captureRef.current ??= new Capture({
      onMessage: (m) => {
        if (m.type === 'size') setFrame({ w: m.width, h: m.height })
        else if (m.type === 'result') engine.handle(m.detections, m.ms, m.at)
        else if (m.type === 'error') setError(m.message)
      },
      onEnded: () => {
        setActive(false)
        engine.reset()
      },
    }))

  useEffect(
    () =>
      engine.listen(setSnap, (line) =>
        setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 30)),
      ),
    [engine],
  )

  useEffect(() => engine.setSettings(settings), [engine, settings])

  // 감지 대상이 바뀔 때만 워커 설정을 다시 보낸다(이름 수정 같은 변경은 무시).
  const detectorKey = useMemo(() => {
    if (!profile) return null
    const timed = settings.timed
      .filter((a) => a.enabled && a.templates[profile]?.length)
      .map((a) => ({ id: a.id, group: a.group, t: a.templates[profile] }))
    const r = settings.rune
    const rune = r.enabled && r.templates[profile]?.length ? r.templates[profile] : undefined
    return JSON.stringify({
      timed,
      rune,
      runeRatio: r.matchRatio,
      runeCheckSec: r.checkSec,
      regions: settings.regions,
      th: settings.matchThreshold,
      fps: settings.fps,
      bank,
    })
  }, [settings, profile, bank])

  useEffect(() => {
    if (!detectorKey || !captureRef.current) return
    const cfg = JSON.parse(detectorKey) as {
      timed: { id: string; group: TimedGroup; t: TemplateData[] }[]
      rune?: TemplateData[]
      runeRatio: number
      runeCheckSec: number
      regions: Regions
      th: number
      fps: number
      bank: DigitBank
    }
    // 디코드 결과는 캐시에서 공유되므로 워커에는 복사본을 보낸다.
    const variants = (list: TemplateData[]) =>
      Promise.all(
        list.map(async (t) => {
          const img = await decodePng(t.png)
          return {
            rgba: { ...img, data: new Uint8ClampedArray(img.data) },
            digitRect: t.digitRect,
            bgTolerance: t.bgTolerance,
          }
        }),
      )
    let cancelled = false
    void (async () => {
      const targets: TargetSpec[] = []
      for (const a of cfg.timed) {
        targets.push({
          id: a.id,
          region: cfg.regions[a.group],
          variants: await variants(a.t),
          method: 'ncc',
          threshold: cfg.th,
        })
      }
      if (cfg.rune) {
        targets.push({
          id: RUNE_ID,
          region: cfg.regions.rune,
          variants: await variants(cfg.rune),
          method: 'shape',
          threshold: cfg.runeRatio,
          intervalMs: cfg.runeCheckSec * 1000,
        })
      }
      if (cancelled) return
      captureRef.current?.send({ type: 'config', fps: cfg.fps, config: { digitBank: cfg.bank, targets } })
      captureRef.current?.setFps(cfg.fps)
    })()
    return () => {
      cancelled = true
    }
  }, [detectorKey, active])

  const start = async () => {
    setError(null)
    unlockAudio()
    if (settings.notifyEnabled && 'Notification' in window) void Notification.requestPermission()
    try {
      await capture().start()
      setActive(true)
    } catch (e) {
      setError(`화면 공유를 시작하지 못했습니다: ${String(e)}`)
    }
  }

  const stop = () => {
    captureRef.current?.stop()
    setActive(false)
    setFrame(null)
    engine.reset()
  }

  const openEditor = (id: string, title: string, withDigits: boolean) => {
    const s = captureRef.current?.snapshot()
    if (!s) return setError('화면 공유 중일 때만 등록할 수 있습니다.')
    setEditor({ id, title, withDigits, snapshot: s })
  }

  const saveEditor = (r: EditorResult) => {
    if (!editor || !profile) return
    const id = editor.id
    // 모양은 덮어쓰지 않고 추가한다(m:ss / 큰 ss / 깜빡임 등 상태별, 룬은 맵별).
    const add = (t: Templates): Templates => ({ ...t, [profile]: [...(t[profile] ?? []), r.template] })
    update((s) =>
      id === RUNE_ID
        ? { ...s, rune: { ...s.rune, templates: add(s.rune.templates) } }
        : { ...s, timed: s.timed.map((a) => (a.id === id ? { ...a, templates: add(a.templates) } : a)) },
    )
    const dr = r.template.digitRect
    if (r.learnText && dr) {
      const text = r.learnText
      void decodePng(r.template.png).then((img) => {
        const crop = cropRgba(img, dr)
        update((s) => withBank(s, profile, (b) => (learn(b, crop, text), b)))
      })
    }
    setEditor(null)
  }

  const timedGroup = (group: TimedGroup) => settings.timed.filter((a) => a.group === group)

  const renderGroup = (group: TimedGroup) =>
    timedGroup(group).map((a) => (
      <TimedRow
        key={a.id}
        alert={a}
        profile={profile}
        status={snap?.targets[a.id]}
        active={active}
        onChange={(na) => update((s) => ({ ...s, timed: s.timed.map((x) => (x.id === na.id ? na : x)) }))}
        onEdit={() => openEditor(a.id, a.name, true)}
        onClear={() =>
          profile &&
          confirm(`"${a.name}"의 ${profile} 모양을 모두 지울까요?`) &&
          update((s) => ({
            ...s,
            timed: s.timed.map((x) => (x.id === a.id ? { ...x, templates: { ...x.templates, [profile]: [] } } : x)),
          }))
        }
        onDelete={() => {
          if (confirm(`"${a.name}" 알림을 삭제할까요?`)) update((s) => ({ ...s, timed: s.timed.filter((x) => x.id !== a.id) }))
        }}
        onTeach={() => {
          const crop = snap?.targets[a.id]?.digitCrop
          if (crop) setTeach({ id: a.id, crop })
        }}
      />
    ))

  const addTimed = (group: TimedGroup) =>
    update((s) => ({ ...s, timed: [...s.timed, newTimedAlert(group, group === 'skill' ? '새 스킬' : '새 버프')] }))

  return (
    <div className="app">
      <header>
        <h1>메이플 타이머</h1>
        <div className="capture-bar">
          {active ? (
            <>
              <span className="dot on" /> 화면 공유 중 · {frame ? `${frame.w} × ${frame.h}` : '해상도 확인 중'}
              {snap && <span className="muted"> · 처리 {snap.frameMs.toFixed(0)}ms</span>}
              <button className="ghost" onClick={stop}>
                중지
              </button>
            </>
          ) : (
            <>
              <span className="dot" /> 화면 공유 꺼짐
              <button onClick={start}>메이플 창 공유 시작</button>
            </>
          )}
        </div>
        {profile && (
          <p className="muted small">
            프로필 <b>{profile}</b> — 아이콘·숫자 학습은 해상도별로 따로 저장됩니다.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </header>

      <section className="toolbar">
        <label>
          🔊 {Math.round(settings.volume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => update((s) => ({ ...s, volume: Number(e.target.value) }))}
          />
        </label>
        <button
          className={settings.allMuted ? 'danger' : 'ghost'}
          onClick={() => update((s) => ({ ...s, allMuted: !s.allMuted }))}
        >
          {settings.allMuted ? '🔕 전체 비활성화됨' : '🔔 전체 비활성화'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={settings.speechEnabled}
            onChange={(e) => update((s) => ({ ...s, speechEnabled: e.target.checked }))}
          />
          음성 안내
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.notifyEnabled}
            onChange={(e) => {
              const on = e.target.checked
              if (on && 'Notification' in window) void Notification.requestPermission()
              update((s) => ({ ...s, notifyEnabled: on }))
            }}
          />
          윈도우 알림
        </label>
        <button
          className="ghost"
          onClick={() => {
            unlockAudio()
            beep(settings.volume)
            if (settings.speechEnabled) setTimeout(() => speak('알림 테스트', settings.volume), 350)
          }}
        >
          소리 테스트
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>스킬 알림</h2>
          <span className="muted small">화면 전체에서 아이콘을 찾습니다 (버프 즐겨찾기 위치 자유)</span>
          <button className="ghost" onClick={() => addTimed('skill')}>
            + 추가
          </button>
        </div>
        {renderGroup('skill')}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>룬 알림</h2>
          <span className="muted small">좌상단 미니맵에서 룬(마름모) 아이콘을 찾습니다</span>
        </div>
        <RuneRow
          rune={settings.rune}
          profile={profile}
          status={snap?.targets[RUNE_ID]}
          active={active}
          onChange={(rune) => update((s) => ({ ...s, rune }))}
          onEdit={() => openEditor(RUNE_ID, '룬', false)}
          onClear={() =>
            profile &&
            confirm(`${profile} 룬 모양을 모두 지울까요?`) &&
            update((s) => ({ ...s, rune: { ...s.rune, templates: { ...s.rune.templates, [profile]: [] } } }))
          }
        />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>버프 종료 알림</h2>
          <span className="muted small">우상단 버프 영역에서 찾습니다 (순서 바뀌어도 OK)</span>
          <button className="ghost" onClick={() => addTimed('buff')}>
            + 추가
          </button>
        </div>
        {renderGroup('buff')}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>숫자 학습 {profile && <span className="muted small">({profile})</span>}</h2>
        </div>
        <p className="small">
          학습된 글자: <b>{learnedChars(bank).join(' ') || '없음'}</b>{' '}
          <span className="muted">— 0~9와 ‘:’가 모두 있어야 남은 시간을 읽을 수 있습니다.</span>
        </p>
        {profile && (
          <div className="inline">
            <label>
              밝기 기준 {bank.threshold}
              <input
                type="range"
                min={80}
                max={250}
                value={bank.threshold}
                onChange={(e) => update((s) => withBank(s, profile, (b) => ({ ...b, threshold: Number(e.target.value) })))}
              />
            </label>
            <button
              className="ghost"
              onClick={() => confirm('이 해상도의 숫자 학습을 모두 지울까요?') && update((s) => withBank(s, profile, (b) => ({ ...b, samples: [] })))}
            >
              학습 초기화
            </button>
          </div>
        )}
      </section>

      <SettingsCard settings={settings} update={update} replace={replace} />

      <section className="card">
        <div className="card-head">
          <h2>알림 기록</h2>
        </div>
        <ul className="log">
          {log.length ? log.map((l, i) => <li key={i}>{l}</li>) : <li className="muted">아직 없음</li>}
        </ul>
      </section>

      {editor && (
        <TemplateEditor
          title={editor.title}
          snapshot={editor.snapshot}
          withDigits={editor.withDigits}
          bank={bank}
          onBankThreshold={(v) => profile && update((s) => withBank(s, profile, (b) => ({ ...b, threshold: v })))}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      )}

      {teach && profile && (
        <TeachDialog
          crop={teach.crop}
          bank={bank}
          onLearn={(text) => update((s) => withBank(s, profile, (b) => (learn(b, teach.crop, text), b)))}
          onClose={() => setTeach(null)}
        />
      )}
    </div>
  )
}

function TeachDialog(p: { crop: Rgba; bank: DigitBank; onLearn: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const glyphs = segment(p.crop, p.bank.threshold).length
  const typed = [...text.replace(/\s+/g, '')].length
  // 처음 학습할 때는 밝기 기준을 자동으로 맞출 수 있다.
  const auto = typed > 0 && typed !== glyphs && !p.bank.samples.length && findThreshold(p.crop, typed) !== null
  return (
    <div className="modal-backdrop" onClick={p.onClose}>
      <div className="modal small-modal" onClick={(e) => e.stopPropagation()}>
        <h3>숫자 가르치기</h3>
        <img className="pixel teach" src={rgbaToDataUrl(p.crop, 8)} alt="" />
        <p className="small">
          그림에 보이는 숫자를 그대로 입력하세요. (분리된 글자 {glyphs}개{auto ? ' → 밝기 기준 자동 조정' : ''})
        </p>
        <input autoFocus value={text} placeholder="예: 1:07" onChange={(e) => setText(e.target.value)} />
        <div className="modal-foot">
          <button className="ghost" onClick={p.onClose}>
            취소
          </button>
          <button
            disabled={!text || (typed !== glyphs && !auto)}
            onClick={() => {
              p.onLearn(text.trim())
              p.onClose()
            }}
          >
            학습
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsCard(p: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
  replace: (s: Settings) => void
}) {
  const s = p.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const regionInput = (key: keyof Regions, label: string) => {
    const r = s.regions[key]
    const field = (k: keyof Rect) => (
      <input
        type="number"
        min={0}
        max={100}
        value={Math.round(r[k] * 100)}
        onChange={(e) =>
          p.update((st) => ({
            ...st,
            regions: { ...st.regions, [key]: { ...st.regions[key], [k]: Math.min(100, Math.max(0, Number(e.target.value))) / 100 } },
          }))
        }
      />
    )
    return (
      <div className="region">
        <b>{label}</b> x {field('x')}% y {field('y')}% 너비 {field('w')}% 높이 {field('h')}%
      </div>
    )
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>설정</h2>
      </div>
      <div className="inline">
        <label>
          초당 검사 횟수
          <input
            type="number"
            min={1}
            max={10}
            value={s.fps}
            onChange={(e) => p.update((st) => ({ ...st, fps: Math.min(10, Math.max(1, Number(e.target.value))) }))}
          />
        </label>
        <label>
          일치 기준 {s.matchThreshold.toFixed(2)}
          <input
            type="range"
            min={0.5}
            max={0.98}
            step={0.01}
            value={s.matchThreshold}
            onChange={(e) => p.update((st) => ({ ...st, matchThreshold: Number(e.target.value) }))}
          />
        </label>
      </div>
      <p className="muted small">탐색 영역 (화면 대비 %)</p>
      {regionInput('skill', '스킬')}
      {regionInput('buff', '버프')}
      {regionInput('rune', '룬/미니맵')}
      <div className="inline">
        <button
          className="ghost"
          onClick={() => {
            const blob = new Blob([exportSettings(s)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `mapletimer-settings-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
          }}
        >
          설정 내보내기
        </button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          설정 가져오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              p.replace({ ...s, ...(JSON.parse(await f.text()) as Settings) })
            } catch {
              alert('설정 파일을 읽지 못했습니다.')
            }
          }}
        />
      </div>
    </section>
  )
}
