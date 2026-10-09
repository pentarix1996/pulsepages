import { describe, expect, it } from 'vitest'
import { advanceRegionState, computeMonitorState, evaluateRun, initialRegionState } from '@shared/monitoring/state.ts'
import type { ProbeResult, RegionState } from '@shared/monitoring/types.ts'

const result = (region: string, status: ProbeResult['status'], error?: string): ProbeResult => ({ region, status, latency_ms: 100, checked_at: '2026-10-09T00:00:00Z', error })
const settings = { confirm_failures: 2, recovery_successes: 2 }

describe('advanceRegionState', () => {
  it('needs consecutive failures to confirm a problem', () => {
    const first = advanceRegionState(undefined, result('eu', 'down', 'boom'), settings)
    expect(first).toMatchObject({ consecutive_bad: 1, confirmed: 'up', last_status: 'down', last_error: 'boom' })
    const second = advanceRegionState(first, result('eu', 'down'), settings)
    expect(second.confirmed).toBe('down')
  })

  it('confirms the latest bad status once confirmed', () => {
    let state: RegionState = initialRegionState('eu')
    state = advanceRegionState(state, result('eu', 'down'), settings)
    state = advanceRegionState(state, result('eu', 'down'), settings)
    state = advanceRegionState(state, result('eu', 'degraded'), settings)
    expect(state.confirmed).toBe('degraded')
  })

  it('needs consecutive successes to confirm recovery', () => {
    let state: RegionState = { ...initialRegionState('eu'), confirmed: 'down', consecutive_bad: 3 }
    state = advanceRegionState(state, result('eu', 'up'), settings)
    expect(state.confirmed).toBe('down')
    state = advanceRegionState(state, result('eu', 'up'), settings)
    expect(state.confirmed).toBe('up')
  })

  it('ignores probe errors (they are not evidence either way)', () => {
    const before: RegionState = { ...initialRegionState('eu'), confirmed: 'down', consecutive_bad: 2 }
    const after = advanceRegionState(before, result('eu', 'error', 'probe timeout'), settings)
    expect(after).toMatchObject({ confirmed: 'down', consecutive_bad: 2, consecutive_up: 0, last_status: 'error' })
  })
})

describe('computeMonitorState', () => {
  const states = (confirmed: Array<RegionState['confirmed']>) => confirmed.map((value, index) => ({ ...initialRegionState(`r${index}`), confirmed: value }))

  it('requires a quorum of regions', () => {
    const regions = ['r0', 'r1', 'r2']
    expect(computeMonitorState(states(['down', 'up', 'up']), regions, 2)).toBe('up')
    expect(computeMonitorState(states(['down', 'down', 'up']), regions, 2)).toBe('down')
    expect(computeMonitorState(states(['down', 'degraded', 'up']), regions, 2)).toBe('degraded')
  })

  it('caps the quorum at the number of active regions', () => {
    expect(computeMonitorState(states(['down']), ['r0'], 3)).toBe('down')
  })
})

describe('evaluateRun', () => {
  it('keeps the current state when every probe of a new monitor errored', () => {
    const run = evaluateRun({ previousState: 'pending', regions: ['eu'], previous: {}, results: [result('eu', 'error', 'probe down')], settings: { ...settings, confirm_regions: 1 } })
    expect(run.state).toBeNull()
  })

  it('produces region states, the monitor state and a summary', () => {
    const run = evaluateRun({
      previousState: 'up',
      regions: ['eu', 'us'],
      previous: { eu: { consecutive_bad: 1, consecutive_up: 0, confirmed: 'up', last_status: 'down' } },
      results: [result('eu', 'down', 'Status 503 is not 200-399.'), result('us', 'up')],
      settings: { ...settings, confirm_regions: 1 },
    })
    expect(run.state).toBe('down')
    expect(run.lastError).toBe('Status 503 is not 200-399.')
    expect(run.regionStates.map((state) => state.confirmed)).toEqual(['down', 'up'])
    expect(run.summary).toMatchObject({ regions: { eu: 'down', us: 'up' }, quorum: 1, latency_ms: 100 })
  })
})
