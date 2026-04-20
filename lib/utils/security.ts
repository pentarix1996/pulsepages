export function escapeHTML(str: string): string {
  if (typeof str !== 'string') return ''
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#96;',
  }
  return str.replace(/[&<>"'/`]/g, (char) => map[char])
}

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim()
}

export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return pattern.test(email.trim())
}

export function validatePassword(password: string): { valid: boolean; message: string } {
  if (typeof password !== 'string') return { valid: false, message: 'Password is required.' }
  if (password.length < 8) return { valid: false, message: 'Minimum 8 characters.' }
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Must contain at least one uppercase letter.' }
  if (!/[a-z]/.test(password)) return { valid: false, message: 'Must contain at least one lowercase letter.' }
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Must contain at least one number.' }
  return { valid: true, message: '' }
}

export function validateURL(url: string): boolean {
  if (typeof url !== 'string') return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function validateSlug(slug: string): boolean {
  if (typeof slug !== 'string') return false
  return /^[a-z0-9-]+$/.test(slug) && slug.length >= 2 && slug.length <= 50
}

const throttleMap = new Map<string, number>()
export function throttle(key: string, fn: () => void, delay = 1000): boolean {
  const now = Date.now()
  const last = throttleMap.get(key) || 0
  if (now - last < delay) return false
  throttleMap.set(key, now)
  fn()
  return true
}

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
export function debounce(key: string, fn: () => void, delay = 300): void {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  debounceTimers[key] = setTimeout(fn, delay)
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  if (typeof obj !== 'object' || obj === null) return obj
  const sanitized = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value)
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized as T
}
