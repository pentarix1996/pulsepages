'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CopyButton } from '@/components/ui/Code'

export interface CodeTab {
  id: string
  label: string
  /** Raw text for the copy button. */
  source: string
  /** Accessible description of the example. */
  summary: string
  /** Highlighted code, rendered on the server. */
  panel: ReactNode
}

/** Tabs over server-rendered snippets: arrow keys move between tabs, the panel keeps one height. */
export function CodeTabs({ tabs, label, minLines }: { tabs: CodeTab[]; label: string; minLines: number }) {
  const [active, setActive] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const current = tabs[active] ?? tabs[0]

  const select = (index: number, focus: boolean) => {
    const next = (index + tabs.length) % tabs.length
    setActive(next)
    if (focus) tabRefs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') select(index + 1, true)
    else if (event.key === 'ArrowLeft') select(index - 1, true)
    else if (event.key === 'Home') select(0, true)
    else if (event.key === 'End') select(tabs.length - 1, true)
    else return
    event.preventDefault()
  }

  if (!current) return null

  return (
    <div className="lp-codecard" style={{ ['--code-lines' as string]: String(minLines) }}>
      <div className="lp-codecard-h">
        <div className="lp-tabs" role="tablist" aria-label={label}>
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              id={`code-tab-${tab.id}`}
              type="button"
              role="tab"
              className="lp-tab"
              aria-selected={index === active}
              aria-controls={`code-panel-${tab.id}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => select(index, false)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton value={current.source} label="Copy" className="lp-copy" />
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          id={`code-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`code-tab-${tab.id}`}
          aria-describedby={`code-summary-${tab.id}`}
          className="lp-codepanel"
          tabIndex={0}
          hidden={index !== active}
        >
          <p id={`code-summary-${tab.id}`} className="sr-only">
            {tab.summary}
          </p>
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
