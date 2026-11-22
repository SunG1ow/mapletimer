import { describe, expect, it } from 'vitest'
import { migrate } from '../../app/store'
import { DEFAULT_SPAWN_PERIOD_SEC } from '../../config'

describe('설정 불러오기', () => {
  it('젠 주기가 예전 기본값 7.5초면 실측 기본값으로, 직접 바꾼 값은 그대로', () => {
    expect(migrate({ spawn: { periodSec: 7.5 } } as never).spawn.periodSec).toBe(DEFAULT_SPAWN_PERIOD_SEC)
    expect(migrate({ spawn: { periodSec: 7.2 } } as never).spawn.periodSec).toBe(7.2)
    expect(migrate({}).spawn.periodSec).toBe(DEFAULT_SPAWN_PERIOD_SEC)
  })
})
