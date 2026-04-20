export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function timeAgo(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const seconds = Math.floor((now - d) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

export function createElement(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      for (const [dKey, dVal] of Object.entries(value)) {
        el.dataset[dKey] = dVal;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }

  return el;
}

export function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function getStatusLabel(status) {
  const labels = {
    operational: 'Operational',
    degraded: 'Degraded Performance',
    partial_outage: 'Partial Outage',
    major_outage: 'Major Outage',
    maintenance: 'Under Maintenance'
  };
  return labels[status] || 'Unknown';
}

export function getStatusColor(status) {
  const colors = {
    operational: 'success',
    degraded: 'warning',
    partial_outage: 'warning',
    major_outage: 'danger',
    maintenance: 'info'
  };
  return colors[status] || 'neutral';
}

export function getStatusDotClass(status) {
  const classes = {
    operational: 'status-dot-operational',
    degraded: 'status-dot-degraded',
    partial_outage: 'status-dot-down',
    major_outage: 'status-dot-down',
    maintenance: 'status-dot-maintenance'
  };
  return classes[status] || '';
}

export function getOverallStatus(components) {
  if (!components || components.length === 0) return 'operational';
  const statuses = components.map(c => c.status);
  if (statuses.includes('major_outage')) return 'major_outage';
  if (statuses.includes('partial_outage')) return 'partial_outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('maintenance')) return 'maintenance';
  return 'operational';
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export function uptimePercentage(incidents, days = 90) {
  if (!incidents || incidents.length === 0) return '100.00';
  const now = Date.now();
  const startDate = now - (days * 24 * 60 * 60 * 1000);
  const recentIncidents = incidents.filter(i => new Date(i.createdAt).getTime() > startDate);
  const totalMinutes = days * 24 * 60;
  const downtimeMinutes = recentIncidents.reduce((sum, i) => sum + (i.duration || 30), 0);
  const uptime = ((totalMinutes - downtimeMinutes) / totalMinutes) * 100;
  return Math.max(0, uptime).toFixed(2);
}
