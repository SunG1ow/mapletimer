// 화면 스냅샷에서 아이콘(과 숫자 영역)을 드래그로 지정해 템플릿을 만든다.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TemplateData } from '../config'
import { binarize, findRule, ruleLabel, segment, type DigitBank, type TextRule } from '../core/digits'
import { TextRuleControl } from './TextRuleControl'
import type { Rect } from '../core/image'
import { cropToPng, cropToRgba } from '../app/templates'
import { foregroundMask } from '../core/match'

type Step = 'area' | 'icon' | 'digits' | 'learn'

export interface EditorResult {
  template: TemplateData
  learnText: string | null
}

interface Props {
  title: string
  snapshot: HTMLCanvasElement
  withDigits: boolean
  bank: DigitBank
  onBankRule: (patch: Partial<TextRule>) => void
  onSave: (r: EditorResult) => void
  onClose: () => void
}

function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** 캔버스 위 드래그로 사각형을 고른다. toImage는 캔버스 픽셀 → 원본 좌표 변환. */
function DragCanvas(props: {
  width: number
  height: number
  draw: (g: CanvasRenderingContext2D, sel: Rect | null) => void
  toImage: (px: number, py: number) => { x: number; y: number }
  onSelect: (r: Rect) => void
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const { draw } = props

  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (g) draw(g, sel)
  }, [draw, sel])

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * props.width
    const py = ((e.clientY - r.top) / r.height) * props.height
    return props.toImage(px, py)
  }

  return (
    <canvas
      ref={ref}
      className={props.className}
      width={props.width}
      height={props.height}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = pos(e)
        setStart(p)
        setSel({ ...p, w: 0, h: 0 })
      }}
      onPointerMove={(e) => start && setSel(normRect(start, pos(e)))}
      onPointerUp={(e) => {
        if (!start) return
        const r = normRect(start, pos(e))
        setStart(null)
        if (r.w >= 2 && r.h >= 2) props.onSelect(r)
        else setSel(null)
      }}
    />
  )
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) }
}

export function TemplateEditor(p: Props) {
  const snap = p.snapshot
  const [step, setStep] = useState<Step>('area')
  const [area, setArea] = useState<Rect | null>(null)
  const [icon, setIcon] = useState<Rect | null>(null)
  const [digits, setDigits] = useState<Rect | null>(null)
  const [learnText, setLearnText] = useState('')
  const [bgTol, setBgTol] = useState(40)

  const fullScale = Math.min(1, 1100 / snap.width)
  const fw = Math.round(snap.width * fullScale)
  const fh = Math.round(snap.height * fullScale)

  const zoom = area ? Math.max(2, Math.min(16, Math.floor(Math.min(720 / area.w, 420 / area.h)))) : 1

  const drawFull = useMemo(
    () => (g: CanvasRenderingContext2D, sel: Rect | null) => {
      g.imageSmoothingEnabled = true
      g.drawImage(snap, 0, 0, fw, fh)
      if (sel) {
        g.strokeStyle = '#ff3b6b'
        g.lineWidth = 2
        g.strokeRect(sel.x * fullScale, sel.y * fullScale, sel.w * fullScale, sel.h * fullScale)
      }
    },
    [snap, fw, fh, fullScale],
  )

  const drawZoom = useMemo(
    () => (g: CanvasRenderingContext2D, sel: Rect | null) => {
      if (!area) return
      g.imageSmoothingEnabled = false
      g.drawImage(snap, area.x, area.y, area.w, area.h, 0, 0, area.w * zoom, area.h * zoom)
      const box = (r: Rect | null, color: string) => {
        if (!r) return
        g.strokeStyle = color
        g.lineWidth = 2
        g.strokeRect((r.x - area.x) * zoom, (r.y - area.y) * zoom, r.w * zoom, r.h * zoom)
      }
      box(icon, '#2bd47d')
      box(digits, '#ffb020')
      box(sel && roundRect(sel), step === 'digits' ? '#ffb020' : '#2bd47d')
    },
    [snap, area, zoom, icon, digits, step],
  )

  const digitPreview = useMemo(() => {
    if (!digits) return null
    const img = cropToRgba(snap, digits)
    const bin = binarize(img, p.bank)
    const glyphs = segment(img, p.bank).length
    const c = document.createElement('canvas')
    const z = 6
    c.width = img.width * z
    c.height = img.height * z * 2
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.drawImage(snap, digits.x, digits.y, digits.w, digits.h, 0, 0, c.width, img.height * z)
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        g.fillStyle = bin[y * img.width + x] ? '#fff' : '#000'
        g.fillRect(x * z, (img.height + y) * z, z, z)
      }
    }
    return { url: c.toDataURL(), glyphs }
  }, [snap, digits, p.bank])

  // 룬: 비교에 쓰일 픽셀만 밝게, 배경(무시)은 어둡게 보여준다.
  const maskPreview = useMemo(() => {
    if (p.withDigits || !icon) return null
    const img = cropToRgba(snap, icon)
    const mask = foregroundMask(img, bgTol)
    const z = Math.max(4, Math.floor(160 / Math.max(icon.w, icon.h)))
    const c = document.createElement('canvas')
    c.width = icon.w * z
    c.height = icon.h * z
    const g = c.getContext('2d')!
    for (let y = 0; y < icon.h; y++) {
      for (let x = 0; x < icon.w; x++) {
        const i = (y * icon.w + x) * 4
        const k = mask[y * icon.w + x] ? 1 : 0.15
        g.fillStyle = `rgb(${img.data[i] * k},${img.data[i + 1] * k},${img.data[i + 2] * k})`
        g.fillRect(x * z, y * z, z, z)
      }
    }
    return { url: c.toDataURL(), count: mask.reduce((a, b) => a + b, 0) }
  }, [p.withDigits, icon, snap, bgTol])

  const save = () => {
    if (!icon) return
    p.onSave({
      template: {
        png: cropToPng(snap, icon),
        width: icon.w,
        height: icon.h,
        digitRect: digits ? { x: digits.x - icon.x, y: digits.y - icon.y, w: digits.w, h: digits.h } : null,
        ...(p.withDigits ? {} : { bgTolerance: bgTol }),
      },
      learnText: digits && learnText.trim() ? learnText.trim() : null,
    })
  }

  const typed = [...learnText.replace(/\s+/g, '')].length
  const auto =
    !!digits && typed > 0 && typed !== digitPreview?.glyphs && !p.bank.samples.length
      ? findRule(cropToRgba(snap, digits), typed, p.bank)
      : null

  return (
    <div className="modal-backdrop" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{p.title} — 템플릿 등록</h3>
          <button className="ghost" onClick={p.onClose}>
            닫기
          </button>
        </div>

        {step === 'area' && (
          <>
            <p className="hint">1. 아이콘이 있는 근처를 넉넉하게 드래그하세요. 다음 단계에서 확대됩니다.</p>
            <DragCanvas
              className="full"
              width={fw}
              height={fh}
              draw={drawFull}
              toImage={(x, y) => ({ x: x / fullScale, y: y / fullScale })}
              onSelect={(r) => {
                const pad = 4
                const x = Math.max(0, Math.floor(r.x) - pad)
                const y = Math.max(0, Math.floor(r.y) - pad)
                setArea({
                  x,
                  y,
                  w: Math.min(snap.width - x, Math.ceil(r.w) + pad * 2),
                  h: Math.min(snap.height - y, Math.ceil(r.h) + pad * 2),
                })
                setIcon(null)
                setDigits(null)
                setStep('icon')
              }}
            />
          </>
        )}

        {area && step !== 'area' && (
          <>
            <p className="hint">
              {step === 'icon' && '2. 아이콘 테두리에 딱 맞게 드래그하세요. (초록)'}
              {step === 'digits' && '3. 아이콘 위 남은 시간 숫자 부분만 드래그하세요. (주황) 이 부분은 매칭에서 제외되고 숫자 인식에 쓰입니다.'}
              {step === 'learn' && '4. 지금 아이콘에 보이는 숫자를 그대로 입력하면 글꼴을 학습합니다. (선택)'}
            </p>
            <div className="zoom-wrap">
              <DragCanvas
                className="zoom"
                width={area.w * zoom}
                height={area.h * zoom}
                draw={drawZoom}
                toImage={(x, y) => ({ x: area.x + x / zoom, y: area.y + y / zoom })}
                onSelect={(r) => {
                  const rr = roundRect(r)
                  if (step === 'icon') setIcon(rr)
                  else if (step === 'digits') {
                    setDigits(rr)
                    setStep('learn')
                  }
                }}
              />
            </div>
          </>
        )}

        {maskPreview && (
          <div className="learn">
            <img src={maskPreview.url} alt="룬 비교 영역" className="pixel" />
            <div className="learn-form">
              <label>
                배경 구분 {bgTol}
                <input type="range" min={10} max={120} value={bgTol} onChange={(e) => setBgTol(Number(e.target.value))} />
              </label>
              <small>
                밝게 보이는 픽셀({maskPreview.count}개)만 비교합니다. 룬 모양만 밝고 미니맵 배경·발판은 어둡게 되도록 조절하세요.
                플레이어 점(노랑/빨강/하늘색)에 가려진 부분은 자동으로 무시됩니다.
              </small>
            </div>
          </div>
        )}

        {step === 'learn' && digitPreview && (
          <div className="learn">
            <img src={digitPreview.url} alt="숫자 미리보기" className="pixel" />
            <div className="learn-form">
              <TextRuleControl rule={p.bank} onChange={p.onBankRule} />
              <small>아래 흑백 그림에서 숫자만 흰색으로 또렷하게 보이도록 조절하세요.</small>
              <label>
                보이는 숫자
                <input value={learnText} placeholder="예: 2:43" onChange={(e) => setLearnText(e.target.value)} />
              </label>
              <small className={learnText && typed !== digitPreview.glyphs && auto === null ? 'warn' : ''}>
                분리된 글자 {digitPreview.glyphs}개{learnText ? ` / 입력 ${typed}자` : ''}
                {auto !== null && ` → 저장 시 ${ruleLabel({ ...p.bank, ...auto })}로 자동 조정`}
              </small>
            </div>
          </div>
        )}

        <div className="modal-foot">
          {step !== 'area' && (
            <button className="ghost" onClick={() => setStep('area')}>
              영역 다시 고르기
            </button>
          )}
          {step === 'icon' && icon && p.withDigits && (
            <>
              <button onClick={() => setStep('digits')}>다음: 숫자 영역</button>
              <button className="ghost" onClick={save}>
                숫자 없이 저장
              </button>
            </>
          )}
          {step === 'icon' && icon && !p.withDigits && <button onClick={save}>저장</button>}
          {step === 'learn' && (
            <>
              <button className="ghost" onClick={() => setStep('digits')}>
                숫자 영역 다시
              </button>
              <button onClick={save} disabled={!!learnText && typed !== digitPreview?.glyphs && auto === null}>
                저장
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
