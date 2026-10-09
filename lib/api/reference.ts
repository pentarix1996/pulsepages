// Turns the generated OpenAPI document into a flat, readable model for /docs/api. Pure.
import '@/lib/api/spec'
import { buildOpenApiDocument } from '@/lib/api/openapi'

type Json = Record<string, unknown>

export interface FieldDoc {
  name: string
  type: string
  required: boolean
  description: string | null
}

export interface OperationDoc {
  id: string
  method: string
  path: string
  summary: string
  description: string | null
  scope: 'read' | 'write' | 'none'
  params: Array<FieldDoc & { in: string }>
  body: FieldDoc[]
  response: { status: string; type: string | null; fields: FieldDoc[] }
  idempotent: boolean
}

export interface TagDoc {
  name: string
  slug: string
  operations: OperationDoc[]
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}

/** Short type label: "string", "integer", "Component[]", "one of: up, down", "string | null". */
export function typeLabel(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== 'object') return 'any'
  const s = schema as Json
  if (typeof s.$ref === 'string') return refName(s.$ref)
  if (Array.isArray(s.enum)) {
    const values = (s.enum as unknown[]).map((value) => JSON.stringify(value).replace(/^"|"$/g, ''))
    return values.length > 6 ? `one of ${values.slice(0, 6).join(', ')}, …` : `one of ${values.join(', ')}`
  }
  if (s.const !== undefined) return JSON.stringify(s.const)
  const union = (s.anyOf ?? s.oneOf) as unknown[] | undefined
  if (Array.isArray(union)) {
    const parts = [...new Set(union.map((item) => typeLabel(item, depth + 1)))]
    return parts.join(' | ')
  }
  if (Array.isArray(s.type)) return (s.type as string[]).join(' | ')
  if (s.type === 'array') {
    const item = typeLabel(s.items, depth + 1)
    return item.startsWith('one of ') ? `list of ${item.slice(7)}` : `${item}[]`
  }
  if (s.type === 'object') {
    if (s.additionalProperties && typeof s.additionalProperties === 'object' && !s.properties) return `map of ${typeLabel(s.additionalProperties, depth + 1)}`
    return 'object'
  }
  if (typeof s.type === 'string') {
    if (s.format === 'uuid') return 'uuid'
    if (s.format === 'date-time') return 'timestamp'
    if (s.format === 'email') return 'email'
    return s.type
  }
  return 'any'
}

function fieldsOf(schema: unknown, schemas: Json): FieldDoc[] {
  if (!schema || typeof schema !== 'object') return []
  let s = schema as Json
  if (typeof s.$ref === 'string') s = (schemas[refName(s.$ref)] as Json) ?? {}
  // Discriminated unions (monitor bodies): merge the variants' fields.
  const variants = (s.oneOf ?? s.anyOf) as Json[] | undefined
  if (Array.isArray(variants) && !s.properties) {
    const merged = new Map<string, FieldDoc>()
    for (const variant of variants) {
      for (const field of fieldsOf(variant, schemas)) {
        const current = merged.get(field.name)
        if (!current) merged.set(field.name, field)
        else if (current.type !== field.type && /^"/.test(current.type) && /^"/.test(field.type)) {
          // Discriminator: "http" + "tcp" → one of http, tcp
          const values = [...current.type.replace(/^one of /, '').split(', '), field.type].map((value) => value.replace(/"/g, ''))
          merged.set(field.name, { ...current, type: `"${[...new Set(values)].join(', ')}` })
        } else if (current.type !== field.type && current.type !== 'object') merged.set(field.name, { ...current, type: current.type.includes(field.type) ? current.type : `${current.type} | ${field.type}` })
      }
    }
    return [...merged.values()].map((field) => (/^"[^"]*, /.test(field.type) ? { ...field, type: `one of ${field.type.replace(/"/g, '')}` } : field))
  }
  const properties = (s.properties ?? {}) as Record<string, Json>
  const required = new Set((s.required as string[] | undefined) ?? [])
  return Object.entries(properties).map(([name, property]) => ({
    name,
    type: typeLabel(property),
    required: required.has(name),
    description: typeof property.description === 'string' ? property.description : null,
  }))
}

export function apiReference(serverUrl: string): { serverUrl: string; tags: TagDoc[]; schemas: Json } {
  const document = buildOpenApiDocument({ serverUrl }) as Json
  const schemas = ((document.components as Json).schemas ?? {}) as Json
  const byTag = new Map<string, OperationDoc[]>()
  for (const [path, methods] of Object.entries(document.paths as Record<string, Record<string, Json>>)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = ((op.tags as string[] | undefined) ?? ['Other'])[0]!
      const params = ((op.parameters as Json[] | undefined) ?? []).map((param) => ({
        name: String(param.name),
        in: String(param.in),
        type: typeLabel(param.schema),
        required: param.required === true,
        description: typeof param.description === 'string' ? param.description : null,
      }))
      const responses = op.responses as Record<string, Json>
      const success = Object.keys(responses).find((code) => code.startsWith('2')) ?? '200'
      const content = ((responses[success]?.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema as Json | undefined
      const dataSchema = content ? ((content.properties as Json | undefined)?.data as Json | undefined) : undefined
      const isList = Boolean(content && (content.properties as Json | undefined)?.next_cursor !== undefined)
      const body = ((op.requestBody as Json | undefined)?.content as Json | undefined)?.['application/json'] as Json | undefined
      const list = byTag.get(tag) ?? []
      list.push({
        id: String(op.operationId),
        method: method.toUpperCase(),
        path,
        summary: String(op.summary ?? ''),
        description: typeof op.description === 'string' ? op.description : null,
        scope: op.security && Array.isArray(op.security) && op.security.length === 0 ? 'none' : ((op['x-upvane-scope'] as 'read' | 'write' | undefined) ?? 'read'),
        params,
        body: body ? fieldsOf(body.schema, schemas) : [],
        response: {
          status: success,
          type: dataSchema ? `${typeLabel(isList ? (dataSchema.items ?? dataSchema) : dataSchema)}${isList ? '[] (paginated)' : ''}` : null,
          fields: dataSchema && !isList ? fieldsOf(dataSchema, schemas) : [],
        },
        idempotent: params.some((param) => param.name === 'Idempotency-Key'),
      })
      byTag.set(tag, list)
    }
  }
  const tags = [...byTag.entries()].map(([name, operations]) => ({ name, slug: slugify(name), operations }))
  return { serverUrl, tags, schemas }
}
