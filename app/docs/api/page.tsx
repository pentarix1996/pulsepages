import type { Metadata } from 'next'
import { apiRateLimitPerMinute } from '@shared/plans.ts'
import { CodeBlock } from '@/components/ui/Code'
import { apiReference, type FieldDoc, type OperationDoc } from '@/lib/api/reference'
import { env } from '@/lib/env'

export const metadata: Metadata = {
  title: 'API reference',
  description: 'Manage status pages, incidents, maintenance, monitors and alert routing with the Upvane REST API.',
  alternates: { canonical: '/docs/api' },
}

/** Renders `code` spans written in descriptions. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/g)
  return <>{parts.map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}</>
}

function Fields({ fields, caption }: { fields: Array<FieldDoc & { in?: string }>; caption: string }) {
  if (fields.length === 0) return null
  return (
    <table className="dc-fields">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Type</th>
          <th scope="col">Description</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={`${field.in ?? ''}${field.name}`}>
            <td>
              <code>{field.name}</code>
              {field.required ? <span className="dc-req">required</span> : null}
              {field.in && field.in !== 'query' ? <span className="dc-in">{field.in}</span> : null}
            </td>
            <td>
              <code className="dc-type">{field.type}</code>
            </td>
            <td>{field.description ? <Inline text={field.description} /> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function curlFor(op: OperationDoc, serverUrl: string): string {
  const path = op.path.replace('{project}', 'my-status-page').replace(/\{(\w+)\}/g, (_match, name: string) => `<${name}>`)
  const lines = [`curl${op.method === 'GET' ? '' : ` -X ${op.method}`} ${serverUrl}${path}`]
  if (op.scope !== 'none') lines.push('  -H "Authorization: Bearer $UPVANE_API_KEY"')
  if (op.idempotent) lines.push('  -H "Idempotency-Key: $(uuidgen)"')
  if (op.body.length > 0) {
    const sample = Object.fromEntries(op.body.filter((field) => field.required).slice(0, 4).map((field) => [field.name, field.type.startsWith('one of') ? field.type.replace('one of ', '').split(',')[0]!.trim() : field.type === 'integer' || field.type === 'number' ? 1 : field.type === 'boolean' ? true : field.type.endsWith('[]') ? [] : '…']))
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${JSON.stringify(sample)}'`)
  }
  return lines.join(' \\\n')
}

export default function ApiReferencePage() {
  const serverUrl = env.apiHost() ? `https://${env.apiHost()}/v1` : `${env.appUrl()}/api/v1`
  const { tags } = apiReference(serverUrl)
  const count = tags.reduce((sum, tag) => sum + tag.operations.length, 0)

  return (
    <div className="lp-wrap dc-layout">
      <nav className="dc-side" aria-label="API sections">
        <a href="#overview">Overview</a>
        <a href="#errors">Errors and limits</a>
        {tags.map((tag) => (
          <a key={tag.slug} href={`#${tag.slug}`}>
            {tag.name}
          </a>
        ))}
        <a className="dc-spec" href="/api/v1/openapi.json">
          OpenAPI 3.1 spec
        </a>
      </nav>
      <div className="dc-body">
        <header className="dc-head" id="overview">
          <h1>API reference</h1>
          <p className="lp-lede">
            {count} endpoints to run Upvane from scripts, CI and Terraform. Everything the dashboard does for status pages, incidents, maintenance, monitors and alerts is here.
          </p>
        </header>

        <section className="dc-section">
          <h2>Authentication</h2>
          <p>
            Create a key in Settings, API keys. Read keys can only read; write keys also change things, with the permissions of an admin. A key can be limited to one status page. Send it as a bearer token:
          </p>
          <CodeBlock language="shell" code={`curl ${serverUrl}/me \\\n  -H "Authorization: Bearer upv_live_…"`} />
          <p>
            Status pages are addressed by their key (<code>my-status-page</code>) or id. Every response wraps the result in <code>data</code>; lists add <code>next_cursor</code>, which you pass back as <code>?cursor=</code> with up to <code>limit=100</code> items per page.
          </p>
        </section>

        <section className="dc-section" id="errors">
          <h2>Errors and limits</h2>
          <p>
            Errors answer with an HTTP status and <code>{'{ "error": "…", "code": "…" }'}</code>. The message is meant for people; branch on <code>code</code>: <code>unauthorized</code>, <code>forbidden</code>, <code>plan_required</code>, <code>plan_limit</code>, <code>not_found</code>, <code>invalid_request</code> (with <code>details</code> per field), <code>conflict</code>, <code>rate_limited</code>, <code>idempotency_conflict</code>.
          </p>
          <p>
            Each key has a per-minute budget ({apiRateLimitPerMinute('pro')} requests on Pro, {apiRateLimitPerMinute('business')} on Business), reported in <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code>. A <code>429</code> carries <code>Retry-After</code>. Write requests accept an <code>Idempotency-Key</code> header: retries with the same key replay the first answer for 24 hours.
          </p>
        </section>

        {tags.map((tag) => (
          <section key={tag.slug} className="dc-section" id={tag.slug}>
            <h2>{tag.name}</h2>
            {tag.operations.map((op) => (
              <article key={op.id} className="dc-op" id={op.id}>
                <div className="dc-op-head">
                  <span className={`dc-method m-${op.method.toLowerCase()}`}>{op.method}</span>
                  <code className="dc-path">{op.path}</code>
                  <span className="dc-scope">{op.scope === 'none' ? 'Token in URL' : op.scope === 'write' ? 'Write key' : 'Read key'}</span>
                </div>
                <h3>{op.summary}</h3>
                {op.description ? (
                  <p className="dc-desc">
                    <Inline text={op.description} />
                  </p>
                ) : null}
                <Fields fields={op.params.filter((param) => param.name !== 'Idempotency-Key')} caption="Parameters" />
                <Fields fields={op.body} caption="Body" />
                <p className="dc-returns">
                  Returns <code>{op.response.status}</code>
                  {op.response.type ? (
                    <>
                      {' '}
                      with <code>{op.response.type}</code>
                    </>
                  ) : null}
                  .
                </p>
                <details className="dc-example">
                  <summary>Example request</summary>
                  <CodeBlock language="shell" code={curlFor(op, serverUrl)} />
                </details>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
