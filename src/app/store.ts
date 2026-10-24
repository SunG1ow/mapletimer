// 설정을 localStorage에 저장/복원한다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_REGIONS, defaultSettings, normalizeTemplates, type Settings } from '../config'

const KEY = 'mapletimer.settings.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      return migrate(JSON.parse(raw) as Partial<Settings>)
    }
  } catch {
    // 손상된 저장값은 무시하고 기본값으로 시작
  }
  return defaultSettings()
}

export function migrate(saved: Partial<Settings>): Settings {
  const base = defaultSettings()
  return {
    ...base,
    ...saved,
    regions: { ...DEFAULT_REGIONS, ...saved.regions },
    timed: (saved.timed ?? base.timed).map((a) => ({ ...a, templates: normalizeTemplates(a.templates) })),
    rune: { ...base.rune, ...saved.rune, templates: normalizeTemplates(saved.rune?.templates) },
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings))
      } catch (e) {
        console.error('설정 저장 실패', e)
      }
    }, 300)
  }, [settings])
  const update = useCallback((fn: (s: Settings) => Settings) => setSettings((s) => fn(s)), [])
  return [settings, update, setSettings] as const
}

/** 바로 저장한다. 저장 공간 부족 등으로 실패하면 예외를 그대로 던진다(가져오기에서 사용자에게 보여 주려고). */
export function saveSettingsNow(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function exportSettings(s: Settings): string {
  return JSON.stringify(s, null, 2)
}
