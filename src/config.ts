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
}

export type Templates = Record<string, TemplateData> // 프로필 키 → 템플릿

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
  speech: string
}

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
  profiles: Record<string, Profile>
}

export const DEFAULT_REGIONS: Regions = {
  skill: { x: 0, y: 0, w: 1, h: 1 }, // 즐겨찾기 버프 아이콘은 어디든 옮길 수 있어 전체 화면
  buff: { x: 0.5, y: 0, w: 0.5, h: 0.3 }, // 우상단
  rune: { x: 0, y: 0, w: 0.35, h: 0.45 }, // 좌상단 미니맵
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
    alertBeforeSec: group === 'skill' ? 5 : 10,
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
    rune: { enabled: true, templates: {}, repeatSec: 30, speech: '룬' },
    profiles: {},
  }
}

export function profileKey(width: number, height: number): string {
  return `${width}x${height}`
}
