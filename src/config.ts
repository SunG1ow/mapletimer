// 사용자 설정 구조와 기본값. 템플릿/숫자 학습은 해상도 프로필(예: "1920x1080")별로 따로 저장한다.

import type { DigitBank } from './core/digits'
import type { Rect } from './core/image'
import type { ColonUnit, PlainUnit } from './core/time'
import type { TimedMode } from './core/trackers'

export interface TemplateData {
  png: string // dataURL
  width: number
  height: number
  /** 템플릿 안에서 숫자가 표시되는 영역. 매칭에서 제외하고 OCR에 쓴다. */
  digitRect: Rect | null
  /** false면 digitRect는 매칭에서 빼기만 하고 숫자는 읽지 않는다(예: 10분 이상일 때 왼쪽 아래 작은 흰 숫자). */
  readDigits?: boolean
  /** 룬: 가장자리(미니맵 배경)와 이 값 이상 다른 픽셀만 비교한다. */
  bgTolerance?: number
}

/** 프로필 키 → 모양 목록. 한 아이콘이 상태에 따라 다르게 보이면(m:ss / 큰 ss / 깜빡임) 여러 개 등록한다. */
export type Templates = Record<string, TemplateData[]>

export const ALERT_BEFORE_MIN = 10
export const ALERT_BEFORE_MAX = 54

export type TimedGroup = 'skill' | 'buff'

export interface TimedAlert {
  id: string
  group: TimedGroup
  name: string
  enabled: boolean
  templates: Templates
  mode: TimedMode
  durationSec: number
  alertBeforeSec: number
  alertOnExpire: boolean
  colonUnit: ColonUnit
  plainUnit: PlainUnit
  speech: string // 비어 있으면 기본 문구
}

export interface RuneAlert {
  enabled: boolean
  templates: Templates
  repeatSec: number
  /** 검사 간격(초). 룬은 몇 초 늦어도 괜찮아 자주 볼 필요가 없다. */
  checkSec: number
  /** 룬 모양 픽셀 중 이 비율 이상 일치하면 발견(플레이어 점에 일부 가려져도 찾도록) */
  matchRatio: number
  speech: string
}

/** 사냥 멈춤 알림: 맨 아래 경험치 바/숫자 띠가 일정 시간 안 바뀌면 알림 */
export interface HuntStopAlert {
  enabled: boolean
  /** 이 시간(초) 동안 경험치 변화가 없으면 멈춘 것으로 본다 */
  stopSec: number
  /** 멈춘 동안 반복 알림 간격(초) */
  repeatSec: number
  speech: string
  /** 감시 영역(화면 비율). 노란 경험치 바와 경험치 숫자가 있는 맨 아래 띠, 오른쪽 퀵슬롯은 제외 */
  region: Rect
}

export const DEFAULT_HUNT_REGION: Rect = { x: 0, y: 0.987, w: 0.68, h: 0.013 }

export interface Regions {
  skill: Rect
  buff: Rect
  rune: Rect
}

export interface Profile {
  digitBank: DigitBank
}

export interface Settings {
  volume: number // 0..1
  allMuted: boolean
  speechEnabled: boolean
  notifyEnabled: boolean
  fps: number
  matchThreshold: number
  regions: Regions // 화면 비율(0..1)
  timed: TimedAlert[]
  rune: RuneAlert
  huntStop: HuntStopAlert
  profiles: Record<string, Profile>
}

export const DEFAULT_REGIONS: Regions = {
  skill: { x: 0, y: 0, w: 1, h: 1 }, // 즐겨찾기 버프 아이콘은 어디든 옮길 수 있어 전체 화면
  buff: { x: 0.5, y: 0, w: 0.5, h: 0.3 }, // 우상단
  // 이 영역에서 미니맵 창(밝은 테두리)을 찾아 그 안만 본다. 미니맵이 큰 맵도 들어오도록 넉넉하게.
  rune: { x: 0, y: 0, w: 0.35, h: 0.45 },
}

export function newTimedAlert(group: TimedGroup, name: string): TimedAlert {
  return {
    id: Math.random().toString(36).slice(2, 10),
    group,
    name,
    enabled: true,
    templates: {},
    mode: 'ocr',
    durationSec: 60,
    alertBeforeSec: group === 'skill' ? 10 : 20,
    alertOnExpire: group === 'buff',
    colonUnit: 'ms',
    plainUnit: 's',
    speech: '',
  }
}

export function defaultSettings(): Settings {
  return {
    volume: 0.8,
    allMuted: false,
    speechEnabled: true,
    notifyEnabled: false,
    fps: 4,
    matchThreshold: 0.8,
    regions: DEFAULT_REGIONS,
    timed: [newTimedAlert('skill', '솔 야누스 : 새벽')],
    rune: { enabled: true, templates: {}, repeatSec: 30, checkSec: 1, matchRatio: 0.65, speech: '룬' },
    huntStop: { enabled: true, stopSec: 60, repeatSec: 15, speech: '사냥 멈춤', region: DEFAULT_HUNT_REGION },
    profiles: {},
  }
}

export function profileKey(width: number, height: number): string {
  return `${width}x${height}`
}

/** 예전 저장 형식(프로필당 템플릿 1개)을 목록으로 바꾼다. */
export function normalizeTemplates(t: Record<string, TemplateData | TemplateData[]> | undefined): Templates {
  const out: Templates = {}
  for (const [k, v] of Object.entries(t ?? {})) out[k] = Array.isArray(v) ? v : [v]
  return out
}

/**
 * 화면 크기에 맞는 프로필을 고른다. 정확히 같은 크기가 없으면 ±64px 안의 가장 가까운 프로필을 쓴다
 * (창 공유 시 제목 표시줄/테두리 때문에 1920x1080이 1922x1112처럼 잡히는 경우).
 */
export function resolveProfile(s: Settings, width: number, height: number): string {
  const exact = profileKey(width, height)
  const keys = new Set<string>(Object.keys(s.profiles))
  for (const a of s.timed) for (const [k, v] of Object.entries(a.templates)) if (v.length) keys.add(k)
  for (const [k, v] of Object.entries(s.rune.templates)) if (v.length) keys.add(k)
  if (keys.has(exact)) return exact
  let best: string | null = null
  let bestD = Infinity
  for (const k of keys) {
    const [w, h] = k.split('x').map(Number)
    const d = Math.abs(w - width) + Math.abs(h - height)
    if (Math.abs(w - width) <= 64 && Math.abs(h - height) <= 64 && d < bestD) {
      best = k
      bestD = d
    }
  }
  return best ?? exact
}
