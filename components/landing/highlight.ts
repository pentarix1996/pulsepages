// Tiny, lossless syntax highlighter for the landing and docs snippets (HCL, YAML, shell with an inline JSON body,
// JSON). Runs on the server; the output is a list of lines, each a list of tokens whose text joins back into the
// original line.

export type TokenClass = 'tx' | 'ky' | 'st' | 'cm' | 'vr' | 'nm'
export type CodeLanguage = 'hcl' | 'yaml' | 'shell' | 'json'

export interface Token {
  text: string
  cls: TokenClass
}

type Rule = { pattern: RegExp; cls: TokenClass | ((match: RegExpExecArray, line: string, index: number) => TokenClass) }

const STRING = /"(?:[^"\\]|\\.)*"/y
const NUMBER = /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y
const LITERAL = /\b(?:true|false|null)\b/y

function push(tokens: Token[], text: string, cls: TokenClass): void {
  if (!text) return
  const last = tokens[tokens.length - 1]
  if (last && last.cls === cls) last.text += text
  else tokens.push({ text, cls })
}

/** Scans `line` from `start` to `end` with the first matching rule at each position; everything else is plain text. */
function scan(line: string, rules: Rule[], tokens: Token[], start = 0, end = line.length): void {
  let index = start
  while (index < end) {
    let matched = false
    for (const rule of rules) {
      rule.pattern.lastIndex = index
      const match = rule.pattern.exec(line)
      if (!match || match[0].length === 0 || match.index !== index || index + match[0].length > end) continue
      const cls = typeof rule.cls === 'function' ? rule.cls(match, line, index) : rule.cls
      push(tokens, match[0], cls)
      index += match[0].length
      matched = true
      break
    }
    if (!matched) {
      push(tokens, line[index]!, 'tx')
      index += 1
    }
  }
}

const JSON_RULES: Rule[] = [
  { pattern: STRING, cls: (match, line, index) => (/^\s*:/.test(line.slice(index + match[0].length)) ? 'ky' : 'st') },
  { pattern: NUMBER, cls: 'nm' },
  { pattern: LITERAL, cls: 'nm' },
]

const HCL_RULES: Rule[] = [
  { pattern: /(?:#|\/\/).*$/y, cls: 'cm' },
  { pattern: STRING, cls: 'st' },
  { pattern: /\b(?:resource|data|terraform|required_providers|provider|variable|output|module|locals)\b(?=\s*["{])/y, cls: 'ky' },
  { pattern: /\b[A-Za-z_][\w-]*(?=\s*=(?!=))/y, cls: 'ky' },
  { pattern: NUMBER, cls: 'nm' },
  { pattern: LITERAL, cls: 'nm' },
]

const YAML_RULES: Rule[] = [
  { pattern: /(?:^|(?<=\s))#.*$/y, cls: 'cm' },
  { pattern: /\$\{\{[^}]*\}\}/y, cls: 'vr' },
  { pattern: STRING, cls: 'st' },
  { pattern: /'[^']*'/y, cls: 'st' },
  { pattern: /(?<=^\s*(?:-\s+)?)[A-Za-z_][\w.-]*(?=:(?:\s|$))/y, cls: 'ky' },
  { pattern: /(?<=:\s+)-?\d+(?:\.\d+)?(?=\s*$)/y, cls: 'nm' },
]

const SHELL_VARIABLE = /\$(?:\{[^}]*\}|\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)/y

/** A double-quoted shell string: green, with the variables inside it in yellow. */
function shellDoubleQuoted(text: string, tokens: Token[]): void {
  const inner: Token[] = []
  scan(text, [{ pattern: SHELL_VARIABLE, cls: 'vr' }], inner)
  for (const token of inner) push(tokens, token.text, token.cls === 'vr' ? 'vr' : 'st')
}

/** Shell lines; a single-quoted argument may span lines and is highlighted as JSON (curl -d '{ … }'). */
function highlightShell(lines: string[]): Token[][] {
  let inQuote = false
  return lines.map((line) => {
    const tokens: Token[] = []
    let index = 0
    if (inQuote) {
      const close = line.indexOf("'")
      if (close === -1) {
        scan(line, JSON_RULES, tokens)
        return tokens
      }
      scan(line, JSON_RULES, tokens, 0, close)
      push(tokens, "'", 'st')
      inQuote = false
      index = close + 1
    }
    while (index < line.length) {
      const char = line[index]!
      const rest = line.slice(index)
      const previous = index === 0 ? ' ' : line[index - 1]!
      if (char === '#' && /\s/.test(previous)) {
        push(tokens, rest, 'cm')
        break
      }
      if (char === "'") {
        const close = line.indexOf("'", index + 1)
        if (close === -1) {
          push(tokens, "'", 'st')
          scan(line, JSON_RULES, tokens, index + 1)
          inQuote = true
          break
        }
        push(tokens, line.slice(index, close + 1), 'st')
        index = close + 1
        continue
      }
      if (char === '"') {
        STRING.lastIndex = index
        const match = STRING.exec(line)
        const end = match && match.index === index ? index + match[0].length : line.length
        shellDoubleQuoted(line.slice(index, end), tokens)
        index = end
        continue
      }
      SHELL_VARIABLE.lastIndex = index
      const variable = SHELL_VARIABLE.exec(line)
      if (variable && variable.index === index) {
        push(tokens, variable[0], 'vr')
        index += variable[0].length
        continue
      }
      const flag = /^--?[A-Za-z][\w-]*/.exec(rest)
      if (flag && /\s/.test(previous)) {
        push(tokens, flag[0], 'ky')
        index += flag[0].length
        continue
      }
      push(tokens, char, 'tx')
      index += 1
    }
    return tokens
  })
}

export function highlight(source: string, language: CodeLanguage): Token[][] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (language === 'shell') return highlightShell(lines)
  const rules = language === 'hcl' ? HCL_RULES : language === 'yaml' ? YAML_RULES : JSON_RULES
  return lines.map((line) => {
    const tokens: Token[] = []
    scan(line, rules, tokens)
    return tokens
  })
}
