'use client'

import { useEffect, useReducer, useRef, type FocusEvent } from 'react'
import { AlertCircleIcon, CheckCircleIcon, CheckIcon, PauseIcon, PlayIcon } from '@/components/ui/icons'
import {
  FINAL_PHASE,
  HISTORY_DAYS,
  STORY_STEPS,
  clockFor,
  consumeClock,
  initialPlayerState,
  isHeld,
  isRunning,
  playerReducer,
  storyFrame,
  type StepClock,
} from './story'

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** Content kept on screen while the incident and the draft card fade out after the story wraps around. */
const FINAL_FRAME = storyFrame(FINAL_PHASE)

/**
 * The landing's single orchestrated animation (DESIGN.md §5): a client island that walks through the outage story
 * with timers. Steps are buttons; hovering the board, focusing a step, scrolling it away or hiding the tab pauses
 * it. With prefers-reduced-motion it shows the final frame and the whole story as text.
 */
export function HeroBoard() {
  const [state, dispatch] = useReducer(playerReducer, undefined, initialPlayerState)
  const boardRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<StepClock | null>(null)
  const running = isRunning(state)
  const held = state.playing && isHeld(state)
  const { phase, run } = state
  const frame = storyFrame(phase)
  const incident = frame.page.incident ?? FINAL_FRAME.page.incident!
  const draft = frame.draft ?? FINAL_FRAME.draft!

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => dispatch({ type: 'reduced-motion', on: query.matches })
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const node = boardRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (entry) dispatch({ type: 'hold', source: 'offscreen', on: !entry.isIntersecting })
      },
      { threshold: 0.3 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => dispatch({ type: 'hold', source: 'hidden', on: document.visibilityState === 'hidden' })
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  // One timer per step; a hold keeps the time already spent so the progress bar and the story stay in step.
  useEffect(() => {
    if (!running) return
    const clock = clockFor(clockRef.current, phase, run)
    clockRef.current = clock
    const startedAt = performance.now()
    const timer = window.setTimeout(() => dispatch({ type: 'advance' }), clock.remaining)
    return () => {
      window.clearTimeout(timer)
      if (clockRef.current === clock) clockRef.current = consumeClock(clock, performance.now() - startedAt)
    }
  }, [running, phase, run])

  const onStepsBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dispatch({ type: 'hold', source: 'focus', on: false })
  }

  return (
    <div className="lp-story-wrap">
      <div ref={boardRef} className={cx('lp-board', held && 'held')}>
        <div className="lp-board-h">
          <div className="lp-board-name">
            <span className={cx('lp-live', frame.down ? 'down' : 'up')} aria-hidden="true" />
            <span>Quillbase production</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm lp-play" onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}>
            {state.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            {state.playing ? 'Pause' : 'Play from here'}
          </button>
        </div>

        <div
          className="lp-board-body"
          onPointerEnter={() => dispatch({ type: 'hold', source: 'hover', on: true })}
          onPointerLeave={() => dispatch({ type: 'hold', source: 'hover', on: false })}
        >
          <div className="lp-panes">
            <div className="lp-pane lp-pane-checks">
              <div className="lp-pane-h">
                <span className="lp-pane-title">Checks</span>
                <span className="lp-pane-sub mono">GET /v2/payments/health</span>
              </div>
              <div className="lp-log mono">
                {frame.lines.map((line) => (
                  <div key={line.id} className={cx('lp-ln', `k-${line.kind}`, !line.region && 'ev', line.visible && 'on')} aria-hidden={line.visible ? undefined : true}>
                    <span className="lp-ln-t">{line.time}</span>
                    {line.region ? (
                      <>
                        <span className="lp-ln-r">{line.region}</span>
                        <span className="lp-ln-c">{line.text}</span>
                        <span className="lp-ln-ms">{line.ms}</span>
                      </>
                    ) : (
                      <span className="lp-ln-c">{line.text}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="lp-pane lp-pane-components">
              <div className="lp-pane-h">
                <span className="lp-pane-title">Components</span>
                <span className="lp-pane-sub">Last {HISTORY_DAYS} days</span>
              </div>
              <div className="lp-comps">
                {frame.components.map((component) => (
                  <div key={component.name} className={cx('lp-crow', component.hot && 'hot')}>
                    <span className="lp-cname">{component.name}</span>
                    <span className="lp-ticks" aria-hidden="true">
                      {component.ticks.map((tick, index) => (
                        <span key={index} className={cx('lp-tk', tick !== 'up' && tick, component.pending && index === component.ticks.length - 1 && 'pending')} />
                      ))}
                    </span>
                    <span className={cx('lp-cst', `st-${component.status}`)}>{component.label}</span>
                  </div>
                ))}
              </div>
              <div className="lp-legend" aria-hidden="true">
                <span>{HISTORY_DAYS} days ago</span>
                <span>Today</span>
              </div>
              <div className={cx('lp-draft', `d-${draft.stage}`, frame.draft && 'on')} aria-hidden={frame.draft ? undefined : true}>
                <span className="lp-draft-tag">{draft.tag}</span>
                <strong className="lp-draft-title">{draft.title}</strong>
                <span className="lp-draft-meta">{draft.meta}</span>
              </div>
            </div>

            <div className="lp-pane lp-pane-public">
              <div className="lp-pane-h">
                <span className="lp-pane-title">What your customers see</span>
                <span className="lp-pane-sub mono">status.quillbase.io</span>
              </div>
              <div className="lp-public">
                <div className="lp-pub">
                  <div className={cx('lp-pub-banner', frame.page.tone)}>
                    {frame.page.tone === 'up' ? <CheckCircleIcon size={16} strokeWidth={2.4} /> : <AlertCircleIcon size={16} strokeWidth={2.4} />}
                    <span>{frame.page.headline}</span>
                  </div>
                  <div className={cx('lp-collapse', frame.page.incident && 'on')} aria-hidden={frame.page.incident ? undefined : true}>
                    <div>
                      <div className="lp-pub-inc">
                        <div className="lp-pub-inc-h">
                          <strong>{incident.title}</strong>
                          <span className="num">{incident.time}</span>
                        </div>
                        <p>
                          <strong className={incident.state === 'Resolved' ? 'pt-operational' : 'pt-major_outage'}>{incident.state}.</strong> {incident.message}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="lp-pub-rows">
                    {frame.page.rows.map((row) => (
                      <div key={row.name} className="lp-pub-row">
                        <span>{row.name}</span>
                        <span className={`pt-${row.status}`}>{row.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <ul className="lp-notices" aria-label="Notifications">
                  {frame.notices.map((notice) => (
                    <li key={notice.id} className={cx('lp-notice', notice.visible && 'on')} aria-hidden={notice.visible ? undefined : true}>
                      <CheckIcon size={16} />
                      <span>{notice.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="lp-steps" role="group" aria-label="Outage timeline" onFocus={() => dispatch({ type: 'hold', source: 'focus', on: true })} onBlur={onStepsBlur}>
            {STORY_STEPS.map((step, index) => {
              const current = index === phase
              return (
                <button
                  key={step.label}
                  type="button"
                  className={cx('lp-step', current && 'on', index < phase && 'done')}
                  aria-pressed={current}
                  onClick={() => dispatch({ type: 'select', phase: index })}
                >
                  <span className="lp-step-bar" aria-hidden="true">
                    <span
                      key={current ? `run-${run}` : 'idle'}
                      className={cx('lp-step-fill', current && state.playing && !state.reducedMotion && 'run')}
                      style={{ animationDuration: `${step.duration}ms` }}
                    />
                  </span>
                  <span className="lp-step-label">{step.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="lp-captions" aria-hidden="true">
        {STORY_STEPS.map((step, index) => (
          <p key={step.label} className={index === phase ? 'on' : undefined}>
            {step.caption}
          </p>
        ))}
      </div>
      {/* Announced only when the visitor drives the story; autoplay would talk every three seconds. */}
      <p className="sr-only" aria-live={state.playing ? 'off' : 'polite'}>
        {frame.caption}
      </p>
      <ol className="lp-story" aria-label="The outage, step by step">
        {STORY_STEPS.map((step, index) => (
          <li key={step.label} aria-current={index === phase ? 'step' : undefined}>
            <strong>{step.label}.</strong> {step.caption}
          </li>
        ))}
      </ol>
    </div>
  )
}
