export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#96;'
  };
  return str.replace(/[&<>"'/`]/g, (char) => map[char]);
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim();
}

export function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(email.trim());
}

export function validatePassword(password) {
  if (typeof password !== 'string') return { valid: false, message: 'La contraseña es requerida.' };
  if (password.length < 8) return { valid: false, message: 'Mínimo 8 caracteres.' };
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Debe contener al menos una mayúscula.' };
  if (!/[a-z]/.test(password)) return { valid: false, message: 'Debe contener al menos una minúscula.' };
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Debe contener al menos un número.' };
  return { valid: true, message: '' };
}

export function validateURL(url) {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateSlug(slug) {
  if (typeof slug !== 'string') return false;
  return /^[a-z0-9-]+$/.test(slug) && slug.length >= 2 && slug.length <= 50;
}

const throttleMap = new Map();
export function throttle(key, fn, delay = 1000) {
  const now = Date.now();
  const last = throttleMap.get(key) || 0;
  if (now - last < delay) return false;
  throttleMap.set(key, now);
  fn();
  return true;
}

let debounceTimers = {};
export function debounce(key, fn, delay = 300) {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(fn, delay);
}

export function generateCSRFToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export function checkSessionExpiry(session) {
  if (!session || !session.expiresAt) return true;
  return Date.now() > session.expiresAt;
}

export function createSecureSession(userId) {
  return {
    userId,
    token: generateCSRFToken(),
    createdAt: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  };
}

export function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
