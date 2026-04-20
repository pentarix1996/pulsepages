import { describe, it, expect } from 'vitest'
import {
  escapeHTML,
  sanitizeInput,
  validateEmail,
  validatePassword,
  validateURL,
  validateSlug,
  sanitizeObject,
} from '@/lib/utils/security'

describe('escapeHTML', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHTML('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
    )
  })

  it('escapes ampersands', () => {
    expect(escapeHTML('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes backticks and single quotes', () => {
    expect(escapeHTML("`hello'")).toBe("&#96;hello&#x27;")
  })

  it('returns empty string for non-string input', () => {
    expect(escapeHTML(null as unknown as string)).toBe('')
    expect(escapeHTML(undefined as unknown as string)).toBe('')
    expect(escapeHTML(123 as unknown as string)).toBe('')
  })

  it('returns same string when no special chars', () => {
    expect(escapeHTML('Hello World 123')).toBe('Hello World 123')
  })
})

describe('sanitizeInput', () => {
  it('strips HTML tags', () => {
    expect(sanitizeInput('<b>bold</b>')).toBe('bold')
  })

  it('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello')
  })

  it('handles empty and non-string values', () => {
    expect(sanitizeInput('')).toBe('')
    expect(sanitizeInput(null as unknown as string)).toBe('')
  })
})

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toBe(true)
    expect(validateEmail('test.user+tag@domain.co.uk')).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(validateEmail('notanemail')).toBe(false)
    expect(validateEmail('@domain.com')).toBe(false)
    expect(validateEmail('user@')).toBe(false)
    expect(validateEmail('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(validateEmail(null as unknown as string)).toBe(false)
  })
})

describe('validatePassword', () => {
  it('accepts a valid password', () => {
    const result = validatePassword('Test1234')
    expect(result.valid).toBe(true)
    expect(result.message).toBe('')
  })

  it('rejects short password', () => {
    expect(validatePassword('Ab1').valid).toBe(false)
  })

  it('rejects password without uppercase', () => {
    expect(validatePassword('test1234').valid).toBe(false)
  })

  it('rejects password without lowercase', () => {
    expect(validatePassword('TEST1234').valid).toBe(false)
  })

  it('rejects password without number', () => {
    expect(validatePassword('Testtest').valid).toBe(false)
  })
})

describe('validateURL', () => {
  it('accepts valid URLs', () => {
    expect(validateURL('https://example.com')).toBe(true)
    expect(validateURL('http://localhost:3000')).toBe(true)
  })

  it('rejects invalid URLs', () => {
    expect(validateURL('not-a-url')).toBe(false)
    expect(validateURL('')).toBe(false)
  })
})

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('my-project')).toBe(true)
    expect(validateSlug('api-v2')).toBe(true)
    expect(validateSlug('ab')).toBe(true)
  })

  it('rejects invalid slugs', () => {
    expect(validateSlug('My Project')).toBe(false)
    expect(validateSlug('a')).toBe(false)
    expect(validateSlug('')).toBe(false)
    expect(validateSlug('a'.repeat(51))).toBe(false)
  })
})

describe('sanitizeObject', () => {
  it('sanitizes string values in object', () => {
    const result = sanitizeObject({ name: '<b>Test</b>', count: 5 })
    expect(result.name).toBe('Test')
    expect(result.count).toBe(5)
  })

  it('sanitizes nested objects', () => {
    const result = sanitizeObject({ nested: { value: '<script>xss</script>' } })
    expect((result.nested as { value: string }).value).toBe('xss')
  })
})
