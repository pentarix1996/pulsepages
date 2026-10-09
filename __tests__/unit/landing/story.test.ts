import { describe, expect, it } from 'vitest'
import {
  FINAL_PHASE,
  STEP_COUNT,
  STORY_STEPS,
  clockFor,
  consumeClock,
  initialPlayerState,
  isRunning,
  nextPhase,
  playerReducer,
  storyFrame,
  type PlayerAction,
  type PlayerState,
} from '@/components/landing/story'

const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state)

describe('story steps', () => {
  it('tells the outage in six steps with a caption each', () => {
    expect(STEP_COUNT).toBe(6)
    expect(STORY_STEPS.map((step) => step.label)).toEqual(['Everything is up', 'A check fails', 'Confirmed in 3 regions', 'On-call paged', 'Incident published', 'Recovered'])
    for (const step of STORY_STEPS) {
      expect(step.duration).toBeGreaterThanOrEqual(2600)
      expect(step.caption.length).toBeGreaterThan(20)
    }
  })

  it('wraps from the last step to the first', () => {
    expect(nextPhase(0)).toBe(1)
    expect(nextPhase(FINAL_PHASE)).toBe(0)
  })
})

describe('storyFrame', () => {
  it('starts green with only passing checks', () => {
    const frame = storyFrame(0)
    expect(frame.down).toBe(false)
    expect(frame.page.tone).toBe('up')
    expect(frame.page.headline).toBe('All systems operational')
    expect(frame.lines.filter((line) => line.visible).every((line) => line.kind === 'ok')).toBe(true)
    expect(frame.draft).toBeNull()
    expect(frame.notices.some((notice) => notice.visible)).toBe(false)
  })

  it('shows failed checks without changing any status on the first failure', () => {
    const frame = storyFrame(1)
    expect(frame.lines.filter((line) => line.visible && line.kind === 'bad').map((line) => line.region)).toEqual(['fra', 'iad', 'sin'])
    expect(frame.components.find((component) => component.name === 'Payments API')).toMatchObject({ status: 'operational', pending: true })
    expect(frame.page.tone).toBe('up')
  })

  it('confirms in three regions and turns the public page red', () => {
    const frame = storyFrame(2)
    expect(frame.lines.find((line) => line.id === 'confirmed')).toMatchObject({ visible: true, text: 'Failure confirmed in 3 of 4 regions' })
    const payments = frame.components.find((component) => component.name === 'Payments API')!
    expect(payments).toMatchObject({ status: 'major_outage', label: 'Major outage', hot: true })
    expect(payments.ticks.at(-1)).toBe('major')
    expect(frame.page).toMatchObject({ tone: 'major', incident: null })
    expect(frame.page.rows.find((row) => row.name === 'Payments API')?.label).toBe('Major outage')
  })

  it('pages the on-call with a private draft before anything is published', () => {
    const frame = storyFrame(3)
    expect(frame.draft).toMatchObject({ stage: 'draft' })
    expect(frame.page.incident).toBeNull()
    expect(frame.notices.filter((notice) => notice.visible).map((notice) => notice.id)).toEqual(['pagerduty', 'slack'])
  })

  it('publishes the incident with the components the on-call set', () => {
    const frame = storyFrame(4)
    expect(frame.page.incident).toMatchObject({ state: 'Investigating', title: 'Failed payments in EU and US-East' })
    expect(frame.page.rows.find((row) => row.name === 'Webhooks')?.label).toBe('Degraded')
    expect(frame.notices.every((notice) => notice.visible)).toBe(true)
  })

  it('ends recovered while today keeps the outage in the daily bar', () => {
    const frame = storyFrame(FINAL_PHASE)
    expect(frame.down).toBe(false)
    expect(frame.page).toMatchObject({ tone: 'up', headline: 'All systems operational' })
    expect(frame.page.incident?.state).toBe('Resolved')
    expect(frame.draft?.stage).toBe('resolved')
    const payments = frame.components.find((component) => component.name === 'Payments API')!
    expect(payments.label).toBe('Operational')
    expect(payments.ticks.at(-1)).toBe('major')
    // The final frame explains the whole outage on its own.
    const visible = frame.lines.filter((line) => line.visible).map((line) => line.id)
    expect(visible).toEqual(expect.arrayContaining(['fra-2', 'iad-2', 'sin-2', 'confirmed', 'recovered']))
  })

  it('is deterministic so the server and the browser render the same bars', () => {
    expect(storyFrame(2)).toEqual(storyFrame(2))
    expect(storyFrame(0).components.every((component) => component.ticks.length === 60)).toBe(true)
  })

  it('clamps unknown phases', () => {
    expect(storyFrame(-3).phase).toBe(0)
    expect(storyFrame(99).phase).toBe(FINAL_PHASE)
  })
})

describe('playerReducer', () => {
  it('autoplays and advances step by step', () => {
    const state = run(initialPlayerState(), { type: 'advance' }, { type: 'advance' })
    expect(state.phase).toBe(2)
    expect(state.run).toBe(2)
    expect(isRunning(state)).toBe(true)
  })

  it('stops autoplay when a step is picked', () => {
    const state = run(initialPlayerState(), { type: 'select', phase: 4 })
    expect(state).toMatchObject({ phase: 4, playing: false })
    expect(isRunning(state)).toBe(false)
    // A timer that fires late is ignored.
    expect(playerReducer(state, { type: 'advance' })).toBe(state)
  })

  it('pauses on hover or focus and resumes when both are released', () => {
    let state = run(initialPlayerState(), { type: 'hold', source: 'hover', on: true }, { type: 'hold', source: 'focus', on: true })
    expect(isRunning(state)).toBe(false)
    expect(playerReducer(state, { type: 'advance' }).phase).toBe(0)
    state = run(state, { type: 'hold', source: 'hover', on: false })
    expect(isRunning(state)).toBe(false)
    state = run(state, { type: 'hold', source: 'focus', on: false })
    expect(isRunning(state)).toBe(true)
    expect(state.playing).toBe(true)
  })

  it('plays again from the current step after a pause', () => {
    const paused = run(initialPlayerState(), { type: 'advance' }, { type: 'pause' })
    expect(paused).toMatchObject({ phase: 1, playing: false })
    const resumed = playerReducer(paused, { type: 'play' })
    expect(resumed).toMatchObject({ phase: 1, playing: true })
    expect(resumed.run).toBe(paused.run + 1)
  })

  it('shows the final frame and never autoplays with reduced motion', () => {
    const state = run(initialPlayerState(), { type: 'reduced-motion', on: true })
    expect(state).toMatchObject({ phase: FINAL_PHASE, playing: false, reducedMotion: true })
    expect(playerReducer(state, { type: 'play' })).toBe(state)
    // Steps can still be picked by hand.
    expect(playerReducer(state, { type: 'select', phase: 2 }).phase).toBe(2)
  })
})

describe('step clock', () => {
  it('keeps the remaining time across a hold and restarts on a new run', () => {
    const state = initialPlayerState()
    const clock = clockFor(null, state.phase, state.run)
    expect(clock.remaining).toBe(STORY_STEPS[0]!.duration)
    const held = consumeClock(clock, 1000)
    expect(clockFor(held, state.phase, state.run).remaining).toBe(STORY_STEPS[0]!.duration - 1000)
    const next = playerReducer(state, { type: 'advance' })
    expect(clockFor(held, next.phase, next.run)).toEqual({ phase: 1, run: 1, remaining: STORY_STEPS[1]!.duration })
    expect(consumeClock(clock, 99_999).remaining).toBe(0)
  })
})
