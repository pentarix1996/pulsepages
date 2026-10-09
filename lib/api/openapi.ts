// OpenAPI 3.1 document for /api/v1, generated from the same zod schemas the routes validate with.
// Each area registers its operations in lib/api/spec/<area>.ts; buildOpenApiDocument() assembles them.
import { z, type ZodType } from 'zod'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface OperationSpec {
  method: HttpMethod
  /** OpenAPI path, e.g. /projects/{project}/components/{component} (relative to /api/v1). */
  path: string
  operationId: string
  summary: string
  description?: string
  tag: string
  /** `none` for token-authenticated endpoints (heartbeats, inbound alerts). */
  scope: 'read' | 'write' | 'none'
  query?: ZodType
  body?: ZodType
  /** Name of a schema registered with `resource()`, or an inline schema. */
  response?: string | ZodType
  /** Response is a paginated list of `response`. */
  list?: boolean
  /** HTTP status of the success response (default 200; 201 for creates, 204 for deletes). */
  status?: number
  idempotent?: boolean
}

/** Named response schemas (`#/components/schemas/<name>`). */
export const resources = new Map<string, ZodType>()

export function resource<T extends ZodType>(name: string, schema: T): T {
  resources.set(name, schema)
  return schema
}

export const operations: OperationSpec[] = []

export function operation(spec: OperationSpec): OperationSpec {
  operations.push(spec)
  return spec
}

const PATH_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  project: 'Status page id or slug.',
  component: 'Component id or key (slug).',
  group: 'Component group id.',
  incident: 'Incident id.',
  maintenance: 'Maintenance window id.',
  monitor: 'Monitor id.',
  channel: 'Alert channel id.',
  rule: 'Alert rule id.',
  subscriber: 'Subscriber id.',
  integration: 'Inbound integration id.',
  slo: 'SLO id.',
  template: 'Incident template id.',
  token: 'Secret token from the dashboard.',
}

type JsonSchema = Record<string, unknown>

function toSchema(schema: ZodType, io: 'input' | 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema
  delete json.$schema
  return json
}

function responseSchema(response: OperationSpec['response'], list: boolean | undefined): JsonSchema {
  const item: JsonSchema = response === undefined ? {} : typeof response === 'string' ? { $ref: `#/components/schemas/${response}` } : toSchema(response, 'output')
  if (list) {
    return {
      type: 'object',
      required: ['data', 'next_cursor'],
      properties: {
        data: { type: 'array', items: item },
        next_cursor: { type: ['string', 'null'], description: 'Pass as `cursor` to get the next page. Null on the last page.' },
      },
    }
  }
  return { type: 'object', required: ['data'], properties: { data: item } }
}

function queryParameters(query: ZodType | undefined): JsonSchema[] {
  if (!query) return []
  const schema = toSchema(query, 'input')
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema.required as string[] | undefined) ?? [])
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    description: property.description,
    schema: property,
  }))
}

const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['error', 'code'],
  properties: {
    error: { type: 'string', description: 'Readable explanation.' },
    code: {
      type: 'string',
      enum: ['unauthorized', 'forbidden', 'plan_required', 'plan_limit', 'not_found', 'invalid_request', 'conflict', 'rate_limited', 'idempotency_conflict', 'unavailable', 'internal'],
    },
    details: { description: 'Validation issues for invalid_request.' },
    request_id: { type: 'string' },
  },
}

export function buildOpenApiDocument(options: { serverUrl: string; version?: string }): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {}
  for (const op of operations) {
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)
    const parameters = [
      ...pathParams.map((name) => ({ name, in: 'path', required: true, description: PATH_PARAMETER_DESCRIPTIONS[name], schema: { type: 'string' } })),
      ...queryParameters(op.query),
      ...(op.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: false, description: 'Retry-safe key; the same key replays the first response for 24 hours.', schema: { type: 'string', maxLength: 255 } }] : []),
    ]
    const status = String(op.status ?? 200)
    const responses: Record<string, JsonSchema> = {}
    responses[status] = status === '204' ? { description: 'Done.' } : { description: 'Success.', content: { 'application/json': { schema: responseSchema(op.response, op.list) } } }
    for (const code of op.scope === 'none' ? ['404', '422', '429'] : ['401', '402', '403', '404', '422', '429']) {
      responses[code] = { $ref: `#/components/responses/E${code}` }
    }
    const entry: JsonSchema = {
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: [op.tag],
      parameters,
      responses,
      ...(op.scope === 'none' ? { security: [] } : { 'x-upvane-scope': op.scope }),
    }
    if (op.body) entry.requestBody = { required: true, content: { 'application/json': { schema: toSchema(op.body, 'input') } } }
    paths[op.path] ??= {}
    paths[op.path]![op.method] = entry
  }

  const schemas: Record<string, JsonSchema> = { Error: ERROR_SCHEMA }
  for (const [name, schema] of resources) schemas[name] = toSchema(schema, 'output')

  const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } })

  return {
    openapi: '3.1.0',
    info: {
      title: 'Upvane API',
      version: options.version ?? '1.0.0',
      description:
        'Manage status pages, components, incidents, maintenance windows, monitors and alert routing. Authenticate with an API key from Settings → API keys: `Authorization: Bearer upv_live_…`. Responses wrap results in `data`; errors are `{ "error", "code" }`.',
    },
    servers: [{ url: options.serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(operations.map((op) => op.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'upv_live_…' } },
      schemas,
      responses: {
        E401: errorResponse('Missing or invalid API key.'),
        E402: errorResponse('The organization plan does not include this.'),
        E403: errorResponse('The key cannot do this (read-only key or other organization).'),
        E404: errorResponse('Not found.'),
        E422: errorResponse('Invalid request.'),
        E429: errorResponse('Rate limited. See Retry-After.'),
      },
    },
  }
}
