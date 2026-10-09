'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { BellIcon, CheckIcon, CopyIcon, MailIcon } from '@/components/ui/icons'

export interface SubscribeComponentOption {
  id: string
  name: string
  group: string | null
}

export interface FeedLink {
  label: string
  href: string
  display: string
}

type Tab = 'email' | 'slack' | 'webhook' | 'feeds'

interface Outcome {
  result: 'confirmation_sent' | 'already_subscribed' | 'subscribed'
  message: string
  signing_secret?: string
}

type FormState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; outcome: Outcome } | { kind: 'error'; message: string }

const OPEN_EVENT = 'upvane:subscribe'

/** Opens the header popover from elsewhere on the page (the phone "Get updates" card). */
export function openSubscribe(tab: Tab = 'email'): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { tab } }))
}

async function submit(endpoint: string, body: Record<string, unknown>): Promise<{ ok: true; outcome: Outcome } | { ok: false; message: string }> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
    const payload = (await response.json().catch(() => null)) as { data?: Outcome; error?: string } | null
    if (response.ok && payload?.data) return { ok: true, outcome: payload.data }
    return { ok: false, message: payload?.error ?? 'Something went wrong. Try again in a moment.' }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' }
  }
}

function Honeypot() {
  return (
    <label className="sp-hp" aria-hidden="true">
      Company
      <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
    </label>
  )
}

function readHoneypot(form: HTMLFormElement): string {
  const field = form.elements.namedItem('company')
  return field instanceof HTMLInputElement ? field.value : ''
}

/** Optional component filter shared by the email, Slack and webhook forms. Nothing selected means everything. */
function ComponentPicker({ components, selected, onChange }: { components: SubscribeComponentOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (components.length < 2) return null
  const groups = new Map<string, SubscribeComponentOption[]>()
  for (const component of components) {
    const key = component.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), component])
  }
  const summary = selected.length === 0 ? 'All components' : selected.length === 1 ? '1 component' : `${selected.length} components`
  return (
    <details className="sp-pick">
      <summary>
        <span>Updates for</span>
        <strong>{summary}</strong>
      </summary>
      <div className="sp-pick-body">
        <p className="sp-faint">Choose the components you care about, or leave everything unchecked to hear about all of them.</p>
        {[...groups.entries()].map(([group, list]) => (
          <fieldset key={group || 'ungrouped'} className="sp-pick-group">
            {group ? <legend>{group}</legend> : null}
            {list.map((component) => (
              <label key={component.id} className="sp-check">
                <input
                  type="checkbox"
                  name="component_ids"
                  value={component.id}
                  checked={selected.includes(component.id)}
                  onChange={(event) => onChange(event.target.checked ? [...selected, component.id] : selected.filter((id) => id !== component.id))}
                />
                <span>{component.name}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </details>
  )
}

function Success({ outcome, children }: { outcome: Outcome; children?: ReactNode }) {
  const title = outcome.result === 'confirmation_sent' ? 'Check your inbox' : outcome.result === 'already_subscribed' ? 'Already subscribed' : 'Subscribed'
  return (
    <div className="sp-success" role="status">
      <span className="sp-success-icon">
        <CheckIcon size={18} strokeWidth={2.6} />
      </span>
      <div className="sp-success-text">
        <strong>{title}</strong>
        <p>{outcome.message}</p>
        {children}
      </div>
    </div>
  )
}

function SecretBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="sp-secret">
      <code className="mono">{secret}</code>
      <button
        type="button"
        className="sp-btn sp-btn-quiet sp-btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(secret)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

/** Email form (popover tab and the phone card). Works without JavaScript as a plain form post. */
export function EmailSubscribeForm({ endpoint, components, selected, onSelected, autoFocus, idPrefix }: { endpoint: string; components: SubscribeComponentOption[]; selected: string[]; onSelected: (ids: string[]) => void; autoFocus?: boolean; idPrefix?: string }) {
  const generated = useId()
  const inputId = `${idPrefix ?? generated}-email`
  const errorId = `${inputId}-error`
  const [email, setEmail] = useState('')
  const [state, setState] = useState<FormState>({ kind: 'idle' })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setState({ kind: 'error', message: 'Enter a full email address, like you@company.com.' })
      return
    }
    setState({ kind: 'busy' })
    const result = await submit(endpoint, { type: 'email', email: value, component_ids: selected, company: readHoneypot(event.currentTarget) })
    setState(result.ok ? { kind: 'done', outcome: result.outcome } : { kind: 'error', message: result.message })
  }

  if (state.kind === 'done') return <Success outcome={state.outcome} />
  const error = state.kind === 'error' ? state.message : null
  return (
    <form className="sp-form" method="post" action={endpoint} onSubmit={onSubmit} noValidate>
      <input type="hidden" name="type" value="email" />
      <label htmlFor={inputId} className="sp-label">
        Work email
      </label>
      <input
        id={inputId}
        name="email"
        className="sp-input"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
          if (state.kind === 'error') setState({ kind: 'idle' })
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoFocus={autoFocus}
        required
      />
      {error ? (
        <p id={errorId} className="sp-error" role="alert">
          {error}
        </p>
      ) : null}
      <ComponentPicker components={components} selected={selected} onChange={onSelected} />
      <Honeypot />
      <button type="submit" className="sp-btn sp-btn-accent" aria-busy={state.kind === 'busy' || undefined} disabled={state.kind === 'busy'}>
        {state.kind === 'busy' ? <span className="sp-spinner" aria-hidden="true" /> : null}
        Subscribe
      </button>
      <p className="sp-fine">We send a confirmation link first. Every email has an unsubscribe link.</p>
    </form>
  )
}

function UrlSubscribeForm({ endpoint, type, components, selected, onSelected }: { endpoint: string; type: 'slack' | 'webhook'; components: SubscribeComponentOption[]; selected: string[]; onSelected: (ids: string[]) => void }) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [url, setUrl] = useState('')
  const [state, setState] = useState<FormState>({ kind: 'idle' })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim()) {
      setState({ kind: 'error', message: type === 'slack' ? 'Paste the Slack webhook URL.' : 'Enter the URL that should receive updates.' })
      return
    }
    setState({ kind: 'busy' })
    const result = await submit(endpoint, { type, url: url.trim(), component_ids: selected, company: readHoneypot(event.currentTarget) })
    setState(result.ok ? { kind: 'done', outcome: result.outcome } : { kind: 'error', message: result.message })
  }

  if (state.kind === 'done') {
    return (
      <Success outcome={state.outcome}>
        {state.outcome.signing_secret ? (
          <>
            <SecretBox secret={state.outcome.signing_secret} />
            <p className="sp-fine">
              Each request carries <span className="mono">Upvane-Signature: t=…,v1=…</span>, an HMAC-SHA256 of <span className="mono">timestamp.body</span> with this secret.
            </p>
          </>
        ) : null}
      </Success>
    )
  }
  const error = state.kind === 'error' ? state.message : null
  return (
    <form className="sp-form" method="post" action={endpoint} onSubmit={onSubmit} noValidate>
      <input type="hidden" name="type" value={type} />
      <p className="sp-muted">
        {type === 'slack'
          ? 'Post every incident and maintenance update to a Slack channel. Create an incoming webhook in Slack and paste its URL.'
          : 'We POST a signed JSON payload to this URL for every incident and maintenance update.'}
      </p>
      <label htmlFor={inputId} className="sp-label">
        {type === 'slack' ? 'Slack webhook URL' : 'Endpoint URL'}
      </label>
      <input
        id={inputId}
        name="url"
        className="sp-input mono"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={type === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://hooks.example.com/status'}
        value={url}
        onChange={(event) => {
          setUrl(event.target.value)
          if (state.kind === 'error') setState({ kind: 'idle' })
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoFocus
        required
      />
      {error ? (
        <p id={errorId} className="sp-error" role="alert">
          {error}
        </p>
      ) : null}
      <ComponentPicker components={components} selected={selected} onChange={onSelected} />
      <Honeypot />
      <button type="submit" className="sp-btn sp-btn-accent" aria-busy={state.kind === 'busy' || undefined} disabled={state.kind === 'busy'}>
        {state.kind === 'busy' ? <span className="sp-spinner" aria-hidden="true" /> : null}
        {type === 'slack' ? 'Add to Slack' : 'Add webhook'}
      </button>
    </form>
  )
}

function Feeds({ feeds }: { feeds: FeedLink[] }) {
  return (
    <div className="sp-feeds">
      <p className="sp-muted">Follow updates in a feed reader, or read the current status from your own tools.</p>
      <ul role="list">
        {feeds.map((feed) => (
          <li key={feed.href} className="sp-feedrow">
            <span>{feed.label}</span>
            <a className="mono" href={feed.href}>
              {feed.display}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

const TAB_LABELS: Record<Tab, string> = { email: 'Email', slack: 'Slack', webhook: 'Webhook', feeds: 'Feeds' }

/** Header button and popover: email, Slack, webhook and feeds (DESIGN.md §7). */
export function SubscribePopover({ endpoint, components, feeds }: { endpoint: string; components: SubscribeComponentOption[]; feeds: FeedLink[] | null }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('email')
  const [selected, setSelected] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const tabs: Tab[] = feeds ? ['email', 'slack', 'webhook', 'feeds'] : ['email', 'slack', 'webhook']

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: Tab }>).detail
      if (detail?.tab) setTab(detail.tab)
      setOpen(true)
      triggerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.indexOf(tab)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    setTab(tabs[next]!)
    document.getElementById(`${panelId}-tab-${tabs[next]}`)?.focus()
  }

  return (
    <div className="sp-subscribe" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="sp-btn sp-btn-accent sp-subscribe-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label="Subscribe to updates"
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={18} className="sp-subscribe-icon" />
        <span className="sp-subscribe-label">Subscribe to updates</span>
      </button>
      {open ? (
        <div className="sp-pop" id={panelId} role="dialog" aria-label="Subscribe to updates">
          <div className="sp-ptabs" role="tablist" aria-label="How to get updates">
            {tabs.map((item) => (
              <button
                key={item}
                id={`${panelId}-tab-${item}`}
                type="button"
                role="tab"
                className="sp-ptab"
                aria-selected={tab === item}
                aria-controls={`${panelId}-panel`}
                tabIndex={tab === item ? 0 : -1}
                onClick={() => setTab(item)}
                onKeyDown={onTabKey}
              >
                {TAB_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="sp-pop-body" id={`${panelId}-panel`} role="tabpanel" aria-labelledby={`${panelId}-tab-${tab}`}>
            {tab === 'email' ? (
              <>
                <p className="sp-muted">Get an email when an incident is opened, updated or resolved, and before scheduled maintenance.</p>
                <EmailSubscribeForm endpoint={endpoint} components={components} selected={selected} onSelected={setSelected} autoFocus idPrefix={`${panelId}-pop`} />
              </>
            ) : null}
            {tab === 'slack' ? <UrlSubscribeForm key="slack" endpoint={endpoint} type="slack" components={components} selected={selected} onSelected={setSelected} /> : null}
            {tab === 'webhook' ? <UrlSubscribeForm key="webhook" endpoint={endpoint} type="webhook" components={components} selected={selected} onSelected={setSelected} /> : null}
            {tab === 'feeds' && feeds ? <Feeds feeds={feeds} /> : null}
          </div>
          <div className="sp-pop-foot">
            <button
              type="button"
              className="sp-btn sp-btn-quiet sp-btn-sm"
              onClick={() => {
                setOpen(false)
                triggerRef.current?.focus()
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Phone layout: the email form at the end of the page (StatusMobile mockup). */
export function SubscribeCard({ endpoint, components, hasFeeds, notice }: { endpoint: string; components: SubscribeComponentOption[]; hasFeeds: boolean; notice?: string | null }) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <section className="sp-card sp-getupdates" aria-labelledby="sp-getupdates-title" id="subscribe">
      <h2 id="sp-getupdates-title">
        <MailIcon size={18} />
        Get updates
      </h2>
      {notice ? (
        <p className="sp-notice" role="status">
          {notice}
        </p>
      ) : null}
      <EmailSubscribeForm endpoint={endpoint} components={components} selected={selected} onSelected={setSelected} idPrefix="sp-card" />
      <p className="sp-fine">
        Also available by{' '}
        <button type="button" className="sp-btn-text sp-inline" onClick={() => openSubscribe('slack')}>
          Slack
        </button>
        ,{' '}
        <button type="button" className="sp-btn-text sp-inline" onClick={() => openSubscribe('webhook')}>
          webhook
        </button>
        {hasFeeds ? (
          <>
            {' '}
            and{' '}
            <button type="button" className="sp-btn-text sp-inline" onClick={() => openSubscribe('feeds')}>
              RSS
            </button>
          </>
        ) : null}
        .
      </p>
    </section>
  )
}
