// The hero's outage story (DESIGN.md §5, the only orchestrated animation): checks arrive, a failure is confirmed in
// three regions, the on-call is paged with a draft incident, the incident is published and everything recovers.
// Pure data + a reducer so the timeline can be tested without a browser.
import { seededTicks, type Tick } from './ticks'

export interface StoryStep {
  label: string
  /** How long the step stays on screen while playing, in milliseconds. */
  duration: number
  caption: string
}

export const STORY_STEPS: readonly StoryStep[] = [
  {
    label: 'Everything is up',
    duration: 2600,
    caption: 'Every check passes, and your status page says so without anyone touching it.',
  },
  {
    label: 'A check fails',
    duration: 2800,
    caption: "Frankfurt and Singapore return a 503 and Virginia times out. One bad check isn't enough to wake anybody up.",
  },
  {
    label: 'Confirmed in 3 regions',
    duration: 3000,
    caption: 'The next check fails in the same three regions. Payments API switches to major outage on its own, and so does your status page.',
  },
  {
    label: 'On-call paged',
    duration: 3000,
    caption: 'Upvane pages your on-call through PagerDuty, posts in Slack and drafts an incident with the affected components filled in. Only your team sees the draft.',
  },
  {
    label: 'Incident published',
    duration: 3000,
    caption: 'Your on-call publishes the incident. It appears on the status page, and 312 subscribers get the same update by email.',
  },
  {
    label: 'Recovered',
    duration: 3800,
    caption: 'Checks pass in every region again. The on-call resolves the incident after 14 minutes, and Upvane starts a postmortem draft with the timeline.',
  },
]

export const STEP_COUNT = STORY_STEPS.length
/** The frame shown without motion: the whole outage is visible in the log, the page and the incident. */
export const FINAL_PHASE = STEP_COUNT - 1

export function stepDuration(phase: number): number {
  return STORY_STEPS[clampPhase(phase)]!.duration
}

export function clampPhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0
  return Math.min(STEP_COUNT - 1, Math.max(0, Math.trunc(phase)))
}

export function nextPhase(phase: number): number {
  return (clampPhase(phase) + 1) % STEP_COUNT
}

// ---------------------------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------------------------

export type LineKind = 'ok' | 'bad' | 'warn' | 'good'

export interface LogLine {
  id: string
  time: string
  /** Probe region short code; empty for events. */
  region: string
  /** HTTP status, `timeout`, or the event text. */
  text: string
  ms: string
  kind: LineKind
  /** First phase in which the line is on screen. */
  from: number
}

export const LOG_LINES: readonly LogLine[] = [
  { id: 'fra-1', time: '16:01:31', region: 'fra', text: '200', ms: '184 ms', kind: 'ok', from: 0 },
  { id: 'iad-1', time: '16:01:31', region: 'iad', text: '200', ms: '203 ms', kind: 'ok', from: 0 },
  { id: 'sin-1', time: '16:01:32', region: 'sin', text: '200', ms: '241 ms', kind: 'ok', from: 0 },
  { id: 'gru-1', time: '16:01:32', region: 'gru', text: '200', ms: '198 ms', kind: 'ok', from: 0 },
  { id: 'fra-2', time: '16:02:01', region: 'fra', text: '503', ms: '1,204 ms', kind: 'bad', from: 1 },
  { id: 'iad-2', time: '16:02:01', region: 'iad', text: 'timeout', ms: '10,000 ms', kind: 'bad', from: 1 },
  { id: 'sin-2', time: '16:02:02', region: 'sin', text: '503', ms: '1,318 ms', kind: 'bad', from: 1 },
  { id: 'confirmed', time: '16:02:31', region: '', text: 'Failure confirmed in 3 of 4 regions', ms: '', kind: 'warn', from: 2 },
  { id: 'fra-3', time: '16:16:31', region: 'fra', text: '200', ms: '192 ms', kind: 'ok', from: 5 },
  { id: 'recovered', time: '16:16:32', region: '', text: 'All regions passing again', ms: '', kind: 'good', from: 5 },
]

export type StoryStatus = 'operational' | 'degraded' | 'major_outage'

const STATUS_TICK: Record<StoryStatus, Tick> = { operational: 'up', degraded: 'deg', major_outage: 'major' }
const STATUS_LABEL: Record<StoryStatus, string> = { operational: 'Operational', degraded: 'Degraded', major_outage: 'Major outage' }

export const HISTORY_DAYS = 60

interface ComponentDef {
  name: string
  seed: number
  events: Record<number, Tick>
  status: (phase: number) => StoryStatus
  /** Worst status of today, which is what the daily bar shows. */
  today: (phase: number) => StoryStatus
}

const COMPONENT_DEFS: readonly ComponentDef[] = [
  { name: 'API Gateway', seed: 3, events: { 21: 'deg' }, status: () => 'operational', today: () => 'operational' },
  {
    name: 'Payments API',
    seed: 7,
    events: { 9: 'part', 38: 'deg' },
    status: (phase) => (phase >= 2 && phase <= 4 ? 'major_outage' : 'operational'),
    today: (phase) => (phase >= 2 ? 'major_outage' : 'operational'),
  },
  {
    name: 'Webhooks',
    seed: 11,
    events: { 47: 'part' },
    status: (phase) => (phase === 4 ? 'degraded' : 'operational'),
    today: (phase) => (phase >= 4 ? 'degraded' : 'operational'),
  },
  { name: 'Dashboard', seed: 5, events: { 30: 'maint' }, status: () => 'operational', today: () => 'operational' },
  { name: 'Postgres', seed: 13, events: { 52: 'maint' }, status: () => 'operational', today: () => 'operational' },
]

export interface FrameComponent {
  name: string
  status: StoryStatus
  label: string
  /** Last tick probing (amber ring): a check failed but nothing is confirmed yet. */
  pending: boolean
  /** Row flashes when its status got worse in this step. */
  hot: boolean
  ticks: Tick[]
}

export interface FrameIncident {
  state: 'Investigating' | 'Resolved'
  title: string
  time: string
  message: string
}

export interface FrameDraft {
  stage: 'draft' | 'published' | 'resolved'
  tag: string
  title: string
  meta: string
}

export interface FrameNotice {
  id: string
  text: string
  visible: boolean
}

export interface StoryFrame {
  phase: number
  caption: string
  /** Overall state for the live dot in the board header. */
  down: boolean
  lines: Array<LogLine & { visible: boolean }>
  components: FrameComponent[]
  page: {
    headline: string
    tone: 'up' | 'major'
    incident: FrameIncident | null
    rows: Array<{ name: string; status: StoryStatus; label: string }>
  }
  draft: FrameDraft | null
  notices: FrameNotice[]
}

const INCIDENT_TITLE = 'Failed payments in EU and US-East'

const NOTICES: ReadonlyArray<{ id: string; text: string; from: number }> = [
  { id: 'pagerduty', text: 'Paged the on-call through PagerDuty', from: 3 },
  { id: 'slack', text: 'Posted in #incidents on Slack', from: 3 },
  { id: 'email', text: 'Emailed the update to 312 subscribers', from: 4 },
]

const historyCache = new Map<string, Tick[]>()

function history(def: ComponentDef): Tick[] {
  const cached = historyCache.get(def.name)
  if (cached) return cached
  const ticks = seededTicks(def.seed, HISTORY_DAYS, def.events)
  historyCache.set(def.name, ticks)
  return ticks
}

function draftFor(phase: number): FrameDraft | null {
  if (phase === 3) {
    return { stage: 'draft', tag: 'Draft incident', title: 'Payments API health is failing', meta: 'Major impact · Payments API · only your team can see it' }
  }
  if (phase === 4) {
    return { stage: 'published', tag: 'Published 16:06', title: INCIDENT_TITLE, meta: 'Investigating · Payments API, Webhooks' }
  }
  if (phase === 5) {
    return { stage: 'resolved', tag: 'Resolved 16:16', title: INCIDENT_TITLE, meta: '14 minutes of impact · postmortem draft ready' }
  }
  return null
}

function incidentFor(phase: number): FrameIncident | null {
  if (phase === 4) {
    return { state: 'Investigating', title: INCIDENT_TITLE, time: '16:06', message: "We're seeing failed payment requests from Europe and US-East. Retries are safe." }
  }
  if (phase === 5) {
    return { state: 'Resolved', title: INCIDENT_TITLE, time: '16:16', message: 'Payments are processing normally. Impact lasted 14 minutes.' }
  }
  return null
}

/** Everything the board shows at a given step. */
export function storyFrame(phaseInput: number): StoryFrame {
  const phase = clampPhase(phaseInput)
  const components = COMPONENT_DEFS.map((def): FrameComponent => {
    const status = def.status(phase)
    const previous = phase > 0 ? def.status(phase - 1) : status
    const ticks = history(def).slice(0, HISTORY_DAYS - 1)
    ticks.push(STATUS_TICK[def.today(phase)])
    return {
      name: def.name,
      status,
      label: STATUS_LABEL[status],
      pending: def.name === 'Payments API' && phase === 1,
      hot: status !== 'operational' && previous !== status,
      ticks,
    }
  })
  const byName = new Map(components.map((component) => [component.name, component]))
  const pageRow = (name: string) => {
    const component = byName.get(name)!
    return { name, status: component.status, label: component.label }
  }
  const down = components.some((component) => component.status === 'major_outage')
  return {
    phase,
    caption: STORY_STEPS[phase]!.caption,
    down,
    lines: LOG_LINES.map((line) => ({ ...line, visible: line.from <= phase })),
    components,
    page: {
      headline: down ? 'Major outage on Payments API' : 'All systems operational',
      tone: down ? 'major' : 'up',
      incident: incidentFor(phase),
      rows: [pageRow('API Gateway'), pageRow('Payments API'), pageRow('Webhooks')],
    },
    draft: draftFor(phase),
    notices: NOTICES.map((notice) => ({ id: notice.id, text: notice.text, visible: notice.from <= phase })),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Player: autoplay with pause, transient holds (hover, focus, off screen, hidden tab) and step selection
// ---------------------------------------------------------------------------------------------------------------

export type HoldSource = 'hover' | 'focus' | 'offscreen' | 'hidden'

export interface PlayerState {
  phase: number
  /** The visitor wants the story to play (false after Pause, after picking a step, or with reduced motion). */
  playing: boolean
  holds: Readonly<Record<HoldSource, boolean>>
  /** Incremented whenever the current step starts from zero, so timers and progress bars restart. */
  run: number
  reducedMotion: boolean
}

export type PlayerAction =
  | { type: 'advance' }
  | { type: 'select'; phase: number }
  | { type: 'pause' }
  | { type: 'play' }
  | { type: 'hold'; source: HoldSource; on: boolean }
  | { type: 'reduced-motion'; on: boolean }

const NO_HOLDS: Record<HoldSource, boolean> = { hover: false, focus: false, offscreen: false, hidden: false }

export function initialPlayerState(): PlayerState {
  return { phase: 0, playing: true, holds: NO_HOLDS, run: 0, reducedMotion: false }
}

export function isHeld(state: PlayerState): boolean {
  return Object.values(state.holds).some(Boolean)
}

/** The timer only runs when the visitor wants it, nothing holds it and motion is allowed. */
export function isRunning(state: PlayerState): boolean {
  return state.playing && !state.reducedMotion && !isHeld(state)
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'advance':
      // A late timer after a pause or hold must not move the story.
      if (!isRunning(state)) return state
      return { ...state, phase: nextPhase(state.phase), run: state.run + 1 }
    case 'select': {
      const phase = clampPhase(action.phase)
      return { ...state, phase, playing: false, run: state.run + 1 }
    }
    case 'pause':
      return state.playing ? { ...state, playing: false } : state
    case 'play':
      if (state.reducedMotion || state.playing) return state
      return { ...state, playing: true, run: state.run + 1 }
    case 'hold':
      if (state.holds[action.source] === action.on) return state
      return { ...state, holds: { ...state.holds, [action.source]: action.on } }
    case 'reduced-motion':
      if (action.on === state.reducedMotion) return state
      return action.on
        ? { ...state, reducedMotion: true, playing: false, phase: FINAL_PHASE, run: state.run + 1 }
        : { ...state, reducedMotion: false }
    default:
      return state
  }
}

/**
 * Remaining time of the current step, kept across holds: a hold pauses the clock, a new run (next step, a picked
 * step or Play) starts it again from the full duration.
 */
export interface StepClock {
  phase: number
  run: number
  remaining: number
}

export function clockFor(previous: StepClock | null, phase: number, run: number): StepClock {
  if (previous && previous.phase === phase && previous.run === run) return previous
  return { phase, run, remaining: stepDuration(phase) }
}

export function consumeClock(clock: StepClock, elapsed: number): StepClock {
  return { ...clock, remaining: Math.max(0, clock.remaining - Math.max(0, elapsed)) }
}
