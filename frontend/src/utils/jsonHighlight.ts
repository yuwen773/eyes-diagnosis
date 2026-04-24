/**
 * HTML escaping utility
 */
export const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * JSON syntax highlighting for display
 * Returns HTML string with colored spans for JSON elements
 */
export const syntaxHighlightJson = (obj: any, depth = 0): string => {
  const indent = '  '.repeat(depth)
  const nextIndent = '  '.repeat(depth + 1)

  if (obj === null) return '<span class="json-null">null</span>'
  if (typeof obj === 'boolean') return `<span class="json-bool">${obj}</span>`
  if (typeof obj === 'number') return `<span class="json-num">${obj}</span>`
  if (typeof obj === 'string') {
    const display = obj.length > 200 ? obj.slice(0, 200) + '…' : obj
    return `<span class="json-str">"${escapeHtml(display)}"</span>`
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="json-bracket">[]</span>'
    const items = obj.map((v: any) => {
      const inner = syntaxHighlightJson(v, depth + 1)
      return `${nextIndent}${inner}`
    })
    const prefix = depth === 0 ? '' : '\n' + nextIndent
    return `<span class="json-bracket">[</span>\n${items.join(',\n')}\n${indent}<span class="json-bracket">]</span>`
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj)
    if (keys.length === 0) return '<span class="json-bracket">{}</span>'
    if (depth > 2) {
      return `<span class="json-bracket">{${keys.length} keys}</span>`
    }
    const pairs = keys.map(k => {
      const v = obj[k]
      const vStr = syntaxHighlightJson(v, depth + 1)
      return `${nextIndent}<span class="json-key">"${escapeHtml(k)}"</span><span class="json-sep">: </span>${vStr}`
    })
    return `<span class="json-bracket">{</span>\n${pairs.join(',\n')}\n${indent}<span class="json-bracket">}</span>`
  }
  return escapeHtml(String(obj))
}

/**
 * Highlight a JSON value for inline display (truncated)
 */
export const highlightJsonValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '<span class="json-null">null</span>'
  }
  if (typeof value === 'boolean') {
    return `<span class="json-bool">${value}</span>`
  }
  if (typeof value === 'number') {
    return `<span class="json-num">${value}</span>`
  }
  if (typeof value === 'string') {
    const display = value.length > 80 ? value.slice(0, 80) + '…' : value
    return `<span class="json-str">"${escapeHtml(display)}"</span>`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span class="json-bracket">[]</span>'
    }
    if (value.length <= 3 && value.every((v: any) => typeof v !== 'object')) {
      const items = value.map((v: any) => {
        if (typeof v === 'string') return `<span class="json-str">"${escapeHtml(v.length > 30 ? v.slice(0, 30) + '…' : v)}"</span>`
        if (typeof v === 'number') return `<span class="json-num">${v}</span>`
        return String(v)
      })
      return `<span class="json-bracket">[</span>${items.join('<span class="json-comma">, </span>')}<span class="json-bracket">]</span>`
    }
    const items = value.slice(0, 2).map((v: any) => {
      if (typeof v === 'string') return `<span class="json-str">"${escapeHtml(v.length > 40 ? v.slice(0, 40) + '…' : v)}"</span>`
      if (typeof v === 'number') return `<span class="json-num">${v}</span>`
      if (typeof v === 'object' && v !== null) return summaryJsonObj(v)
      return String(v)
    })
    const remaining = value.length - 2
    const summary = remaining > 0 ? `<span class="json-more"> +${remaining} more</span>` : ''
    return `<span class="json-bracket">[</span>${items.join('<span class="json-comma">, </span>')}${summary}<span class="json-bracket">]</span><span class="json-count"> (${value.length} items)</span>`
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value)
    if (keys.length === 0) return '<span class="json-bracket">{}</span>'
    if (keys.length <= 2) {
      const parts = keys.map(k => {
        const v = value[k]
        const vStr = typeof v === 'string'
          ? `<span class="json-str">"${escapeHtml(v)}"</span>`
          : typeof v === 'number' ? `<span class="json-num">${v}</span>`
          : typeof v === 'boolean' ? `<span class="json-bool">${v}</span>`
          : summaryJsonObj(v)
        return `<span class="json-key">"${escapeHtml(k)}"</span><span class="json-sep">: </span>${vStr}`
      })
      return `<span class="json-bracket">{</span>${parts.join('<span class="json-comma">, </span>')}<span class="json-bracket">}</span>`
    }
    const first = keys[0]
    const firstVal = value[first]
    const firstStr = typeof firstVal === 'string'
      ? `<span class="json-str">"${escapeHtml(firstVal)}"</span>`
      : typeof firstVal === 'number' ? `<span class="json-num">${firstVal}</span>`
      : summaryJsonObj(firstVal)
    return `<span class="json-key">"${escapeHtml(first)}"</span><span class="json-sep">: </span>${firstStr}<span class="json-more"> +${keys.length - 1} more</span>`
  }
  return escapeHtml(String(value))
}

const summaryJsonObj = (obj: any): string => {
  if (obj === null) return '<span class="json-null">null</span>'
  if (Array.isArray(obj)) return `<span class="json-bracket">[${obj.length} items]</span>`
  if (typeof obj === 'object') {
    const keys = Object.keys(obj)
    return `<span class="json-bracket">{${keys.length} keys}</span>`
  }
  return String(obj)
}

/**
 * Parse and highlight a JSON string
 */
export const highlightJson = (str: string): string => {
  try {
    const obj = JSON.parse(str)
    return syntaxHighlightJson(obj, 0)
  } catch {
    return escapeHtml(str)
  }
}
