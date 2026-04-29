'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { StatusDot } from '@/components/ui/StatusDot'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { getStatusLabel, formatDateTime } from '@/lib/utils/helpers'
import { MONITOR_LIMITS } from '@/lib/monitoring/types'
import type { Component, ComponentMonitorConfig, ComponentStatus, MonitorCheckResult } from '@/lib/types'

const STATUS_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'degraded', label: 'Degraded Performance' },
  { value: 'partial_outage', label: 'Partial Outage' },
  { value: 'major_outage', label: 'Major Outage' },
  { value: 'maintenance', label: 'Maintenance' },
]

const METHOD_OPTIONS = [
  { value: 'GET', label: 'GET' },
  { value: 'HEAD', label: 'HEAD' },
]

const RESPONSE_OPTIONS = [
  { value: 'none', label: 'No body rules' },
  { value: 'json', label: 'JSON rules' },
]

const CHECK_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
]

const RESULTING_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All component statuses' },
  ...STATUS_OPTIONS,
]

const RESULTS_FILTER = {
  COMPONENT: 'component',
  CHECK_STATUS: 'checkStatus',
  RESULTING_STATUS: 'resultingStatus',
} as const

type ResultsFilter = (typeof RESULTS_FILTER)[keyof typeof RESULTS_FILTER]

const OPERATOR_OPTIONS = [
  { value: 'exists', label: 'exists' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
]

interface DraftConfig {
  mode: 'manual' | 'automatic'
  enabled: boolean
  url: string
  method: 'GET' | 'HEAD'
  interval_seconds: number
  timeout_ms: number
  expected_status_codes: string
  response_type: 'none' | 'json'
  json_path: string
  json_operator: string
  json_value: string
  json_target_status: ComponentStatus
  failure_status: ComponentStatus
  no_match_status: ComponentStatus
}

export default function ProjectMonitoringPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const { user } = useAuth()
  const { addToast } = useToast()
  const { getProjectById, refreshData } = useStore()
  const project = getProjectById(projectId)

  const [configs, setConfigs] = useState<Record<string, ComponentMonitorConfig>>({})
  const [drafts, setDrafts] = useState<Record<string, DraftConfig>>({})
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({})
  const [allResults, setAllResults] = useState<MonitorCheckResult[]>([])
  const [resultsPage, setResultsPage] = useState(1)
  const [componentFilter, setComponentFilter] = useState('')
  const [checkStatusFilter, setCheckStatusFilter] = useState('')
  const [resultingStatusFilter, setResultingStatusFilter] = useState('')
  const [resultsRefreshToken, setResultsRefreshToken] = useState(0)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  const canUseAutomatic = user?.plan === 'pro' || user?.plan === 'business'

  useEffect(() => {
    async function loadMonitoring() {
      if (!projectId || !project) return
      setLoading(true)
      const params = new URLSearchParams({ projectId })
      const response = await fetch(`/api/monitoring/config?${params.toString()}`)
      const payload = await response.json()
      if (!response.ok) {
        addToast(formatMonitoringError(payload, 'Could not load monitoring settings.'), 'error')
        setLoading(false)
        return
      }

      const configMap: Record<string, ComponentMonitorConfig> = {}
      for (const config of payload.configs as ComponentMonitorConfig[]) {
        configMap[config.component_id] = config
      }
      setConfigs(configMap)
      setDrafts(createDrafts(project.components, configMap))
      setCollapsedCards(createCollapsedCards(project.components))
      setAllResults(payload.results as MonitorCheckResult[])
      setLoading(false)
    }

    void loadMonitoring()
  }, [projectId, project, resultsRefreshToken, addToast])

  if (!project || !user) {
    return <EmptyState title="Project not found" description="This project doesn't exist or you don't have access." action={<Button variant="primary" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>} />
  }

  const currentProject = project
  const filteredResults = filterCheckResults(allResults, componentFilter, checkStatusFilter, resultingStatusFilter)
  const resultsCount = filteredResults.length
  const resultsStart = (resultsPage - 1) * MONITOR_LIMITS.RECENT_RESULTS_LIMIT
  const results = filteredResults.slice(resultsStart, resultsStart + MONITOR_LIMITS.RECENT_RESULTS_LIMIT)

  async function saveConfig(component: Component) {
    const draft = drafts[component.id]
    if (!draft) return
    setSavingId(component.id)

    const jsonRules = draft.response_type === 'json' && draft.json_path
      ? [{ path: draft.json_path, operator: draft.json_operator, value: parseRuleValue(draft.json_value), targetStatus: draft.json_target_status }]
      : []

    const response = await fetch('/api/monitoring/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        component_id: component.id,
        mode: draft.mode,
        enabled: draft.enabled,
        url: draft.url,
        method: draft.method,
        interval_seconds: draft.interval_seconds,
        timeout_ms: draft.timeout_ms,
        expected_status_codes: draft.expected_status_codes.split(',').map((code) => Number(code.trim())).filter(Boolean),
        response_type: draft.response_type,
        json_rules: jsonRules,
        failure_status: draft.failure_status,
        no_match_status: draft.no_match_status,
      }),
    })
    const payload = await response.json()
    if (!response.ok) {
      addToast(formatMonitoringError(payload, 'Could not save monitor config.'), 'error')
    } else {
      setConfigs((prev) => ({ ...prev, [component.id]: payload.config }))
      addToast('Monitoring settings saved.', 'success')
    }
    setSavingId(null)
  }

  async function runNow(componentId: string) {
    const config = configs[componentId]
    if (!config) return
    setRunningId(componentId)
    const response = await fetch('/api/monitoring/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config_id: config.id }),
    })
    const payload = await response.json()
    if (!response.ok) {
      addToast(formatMonitoringError(payload, 'Could not run monitor check.'), 'error')
    } else {
      setResultsPage(1)
      setResultsRefreshToken((prev) => prev + 1)
      await refreshData()
      addToast('Check completed.', 'success')
    }
    setRunningId(null)
  }

  function updateDraft(componentId: string, patch: Partial<DraftConfig>) {
    setDrafts((prev) => ({ ...prev, [componentId]: { ...prev[componentId], ...patch } }))
  }

  function toggleCard(componentId: string) {
    setCollapsedCards((prev) => ({ ...prev, [componentId]: !prev[componentId] }))
  }

  function setAllCardsCollapsed(collapsed: boolean) {
    const next: Record<string, boolean> = {}
    for (const component of currentProject.components) next[component.id] = collapsed
    setCollapsedCards(next)
  }

  function updateResultsFilter(filter: ResultsFilter, value: string) {
    if (filter === RESULTS_FILTER.COMPONENT) setComponentFilter(value)
    if (filter === RESULTS_FILTER.CHECK_STATUS) setCheckStatusFilter(value)
    if (filter === RESULTS_FILTER.RESULTING_STATUS) setResultingStatusFilter(value)
    setResultsPage(1)
  }

  const componentFilterOptions = [
    { value: '', label: 'All components' },
    ...currentProject.components.map((component) => ({ value: component.id, label: component.name })),
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Monitoring</h1>
          <p className="page-description">Configure health checks for {project.name}. Automatic checks run every minute.</p>
        </div>
        <div className="monitoring-header-actions">
          <Button variant="ghost" size="sm" onClick={() => setAllCardsCollapsed(false)}>Expand all</Button>
          <Button variant="ghost" size="sm" onClick={() => setAllCardsCollapsed(true)}>Collapse all</Button>
          <Link className="btn btn-ghost btn-sm" href={`/project/${projectId}`}>Back to project</Link>
        </div>
      </div>

      {!canUseAutomatic ? (
        <div className="monitoring-upgrade-card">
          <div>
            <h2>Automatic monitoring is a Pro feature</h2>
            <p>Free projects stay in manual mode. Upgrade to Pro or Business to enable URL checks.</p>
          </div>
          <Link className="btn btn-primary" href="/settings">Upgrade plan</Link>
        </div>
      ) : null}

      {loading ? (
        <div className="monitoring-loading"><Spinner size={24} /></div>
      ) : project.components.length === 0 ? (
        <EmptyState title="No components" description="Add components before configuring monitoring." />
      ) : (
        <div className="monitoring-grid">
          {project.components.map((component) => {
            const draft = drafts[component.id]
            const config = configs[component.id]
            const isCollapsed = collapsedCards[component.id] ?? true
            if (!draft) return null

            return (
              <section className="monitoring-card" key={component.id} data-collapsed={isCollapsed}>
                <div className="monitoring-card-header">
                  <button className="monitoring-card-toggle" type="button" onClick={() => toggleCard(component.id)} aria-expanded={!isCollapsed} aria-controls={`monitoring-panel-${component.id}`}>
                    <span className="monitoring-card-chevron" aria-hidden="true">▾</span>
                    <span className="component-item-info">
                      <StatusDot status={component.status} />
                      <span>
                        <h2>{component.name}</h2>
                        <p>{getStatusLabel(component.status)} · {draft.mode === 'automatic' ? 'Automatic' : 'Manual'}</p>
                      </span>
                    </span>
                  </button>
                  <div className="monitoring-actions">
                    {isCollapsed ? (
                      <button className="monitoring-expand-link" type="button" onClick={() => toggleCard(component.id)}>Configure</button>
                    ) : (
                      <>
                        <Button variant="subtle" size="sm" loading={runningId === component.id} disabled={!config || draft.mode !== 'automatic'} onClick={() => runNow(component.id)}>{config ? 'Run check now' : 'Save before run'}</Button>
                        <Button variant="primary" size="sm" loading={savingId === component.id} onClick={() => saveConfig(component)}>Save</Button>
                      </>
                    )}
                  </div>
                </div>

                {!isCollapsed ? (
                  <div id={`monitoring-panel-${component.id}`}>
                    <div className="monitoring-form-grid">
                      <Select label="Mode" options={[{ value: 'manual', label: 'Manual' }, { value: 'automatic', label: 'Automatic' }]} value={draft.mode} onChange={(event) => updateDraft(component.id, { mode: event.target.value as DraftConfig['mode'], enabled: event.target.value === 'automatic' })} disabled={!canUseAutomatic} />
                      <Select label="Method" options={METHOD_OPTIONS} value={draft.method} onChange={(event) => updateDraft(component.id, { method: event.target.value as DraftConfig['method'] })} disabled={draft.mode === 'manual'} />
                      <div>
                        <Input label="Interval seconds" type="number" min={MONITOR_LIMITS.MVP_MIN_INTERVAL_SECONDS} value={draft.interval_seconds} onChange={(event) => updateDraft(component.id, { interval_seconds: normalizeIntervalInput(event.target.value) })} disabled={draft.mode === 'manual'} />
                        <p className="monitoring-field-hint">Minimum 60 seconds. New monitors default to 60 seconds.</p>
                      </div>
                      <Input label="Timeout ms" type="number" min={1000} max={MONITOR_LIMITS.MAX_TIMEOUT_MS} value={draft.timeout_ms} onChange={(event) => updateDraft(component.id, { timeout_ms: Number(event.target.value) })} disabled={draft.mode === 'manual'} />
                      <Input label="Healthcheck URL" value={draft.url} placeholder="https://api.example.com/health" onChange={(event) => updateDraft(component.id, { url: event.target.value })} disabled={draft.mode === 'manual'} />
                      <Input label="Expected status codes" value={draft.expected_status_codes} placeholder="200,204" onChange={(event) => updateDraft(component.id, { expected_status_codes: event.target.value })} disabled={draft.mode === 'manual'} />
                      <Select label="Response type" options={RESPONSE_OPTIONS} value={draft.response_type} onChange={(event) => updateDraft(component.id, { response_type: event.target.value as DraftConfig['response_type'] })} disabled={draft.mode === 'manual'} />
                      <Select label="Request failure status" options={STATUS_OPTIONS} value={draft.failure_status} onChange={(event) => updateDraft(component.id, { failure_status: event.target.value as ComponentStatus })} disabled={draft.mode === 'manual'} />
                    </div>

                    {draft.response_type === 'json' && draft.mode === 'automatic' ? (
                      <div className="monitoring-rule-grid">
                        <Input label="JSON path" value={draft.json_path} placeholder="status.component.db" onChange={(event) => updateDraft(component.id, { json_path: event.target.value })} mono />
                        <Select label="Operator" options={OPERATOR_OPTIONS} value={draft.json_operator} onChange={(event) => updateDraft(component.id, { json_operator: event.target.value })} />
                        <Input label="Value" value={draft.json_value} placeholder="ok" onChange={(event) => updateDraft(component.id, { json_value: event.target.value })} />
                        <Select label="Target status" options={STATUS_OPTIONS} value={draft.json_target_status} onChange={(event) => updateDraft(component.id, { json_target_status: event.target.value as ComponentStatus })} />
                        <Select label="No match status" options={STATUS_OPTIONS} value={draft.no_match_status} onChange={(event) => updateDraft(component.id, { no_match_status: event.target.value as ComponentStatus })} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <section className="editor-section monitoring-results">
        <div className="editor-section-header"><h2 className="editor-section-title">Recent checks</h2></div>
        <div className="monitoring-results-filters">
          <Select label="Component" options={componentFilterOptions} value={componentFilter} onChange={(event) => updateResultsFilter(RESULTS_FILTER.COMPONENT, event.target.value)} />
          <Select label="Check status" options={CHECK_STATUS_FILTER_OPTIONS} value={checkStatusFilter} onChange={(event) => updateResultsFilter(RESULTS_FILTER.CHECK_STATUS, event.target.value)} />
          <Select label="Component status" options={RESULTING_STATUS_FILTER_OPTIONS} value={resultingStatusFilter} onChange={(event) => updateResultsFilter(RESULTS_FILTER.RESULTING_STATUS, event.target.value)} />
        </div>
        {results.length === 0 ? <EmptyState title="No checks yet" description="Run a check manually or wait for the cron runner." /> : (
          <div className="monitoring-results-list">
            {results.map((result) => {
              const component = project.components.find((item) => item.id === result.component_id)
              return (
                <div className="monitoring-result-row" key={result.id}>
                  <span>{component?.name ?? 'Component'}</span>
                  <span className={`monitoring-result-status monitoring-result-status-${result.status}`}>{result.status}</span>
                  <span>{result.resulting_status ? getStatusLabel(result.resulting_status) : 'No status'}</span>
                  <span>{result.http_status ?? '—'}</span>
                  <span>{result.response_time_ms ?? 0}ms</span>
                  <span>{formatDateTime(result.checked_at)}</span>
                </div>
              )
            })}
            <Pagination page={resultsPage} limit={MONITOR_LIMITS.RECENT_RESULTS_LIMIT} totalCount={resultsCount} onPageChange={setResultsPage} isLoading={loading} itemLabel="checks" />
          </div>
        )}
      </section>
    </>
  )
}

function createDrafts(components: Component[], configs: Record<string, ComponentMonitorConfig>): Record<string, DraftConfig> {
  const drafts: Record<string, DraftConfig> = {}
  for (const component of components) {
    const config = configs[component.id]
    const firstRule = Array.isArray(config?.json_rules) ? config.json_rules[0] as Record<string, unknown> | undefined : undefined
    drafts[component.id] = {
      mode: config?.mode ?? 'manual',
      enabled: config?.enabled ?? false,
      url: config?.url ?? '',
      method: config?.method ?? 'GET',
      interval_seconds: config?.interval_seconds ?? MONITOR_LIMITS.DEFAULT_INTERVAL_SECONDS,
      timeout_ms: config?.timeout_ms ?? MONITOR_LIMITS.DEFAULT_TIMEOUT_MS,
      expected_status_codes: (config?.expected_status_codes ?? [200]).join(','),
      response_type: config?.response_type ?? 'none',
      json_path: typeof firstRule?.path === 'string' ? firstRule.path : '',
      json_operator: typeof firstRule?.operator === 'string' ? firstRule.operator : 'equals',
      json_value: firstRule?.value === undefined ? '' : String(firstRule.value),
      json_target_status: typeof firstRule?.targetStatus === 'string' ? firstRule.targetStatus as ComponentStatus : 'operational',
      failure_status: config?.failure_status ?? 'major_outage',
      no_match_status: config?.no_match_status ?? 'degraded',
    }
  }
  return drafts
}

function createCollapsedCards(components: Component[]): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {}
  for (const component of components) collapsed[component.id] = true
  return collapsed
}

function normalizeIntervalInput(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return MONITOR_LIMITS.DEFAULT_INTERVAL_SECONDS
  return Math.max(MONITOR_LIMITS.MVP_MIN_INTERVAL_SECONDS, Math.floor(parsed))
}

function filterCheckResults(
  results: MonitorCheckResult[],
  componentId: string,
  checkStatus: string,
  resultingStatus: string
): MonitorCheckResult[] {
  return results.filter((result) => (
    (!componentId || result.component_id === componentId) &&
    (!checkStatus || result.status === checkStatus) &&
    (!resultingStatus || result.resulting_status === resultingStatus)
  ))
}

function parseRuleValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return value
}

function formatMonitoringError(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const data = payload as Record<string, unknown>
  const error = typeof data.error === 'string' ? data.error : fallback
  const details = typeof data.details === 'string' ? data.details : null
  return details ? `${error} ${details}` : error
}
