import { describe, expect, it } from 'vitest'
import { highlight, type Token } from '@/components/landing/highlight'
import { SNIPPETS } from '@/components/landing/snippets'

const joined = (lines: Token[][]) => lines.map((line) => line.map((token) => token.text).join('')).join('\n')
const classOf = (lines: Token[][], text: string) => lines.flat().find((token) => token.text.includes(text))?.cls

describe('highlight', () => {
  it('never changes the text of any snippet', () => {
    for (const snippet of SNIPPETS) {
      expect(joined(highlight(snippet.source, snippet.language))).toBe(snippet.source)
    }
  })

  it('colors HCL keys, strings and numbers', () => {
    const lines = highlight('resource "upvane_monitor" "payments" {\n  interval_seconds = 60 # seconds\n}', 'hcl')
    expect(lines[0]![0]).toEqual({ text: 'resource', cls: 'ky' })
    expect(classOf(lines, '"upvane_monitor"')).toBe('st')
    expect(classOf(lines, 'interval_seconds')).toBe('ky')
    expect(classOf(lines, '60')).toBe('nm')
    expect(classOf(lines, '# seconds')).toBe('cm')
  })

  it('colors YAML keys and GitHub expressions', () => {
    const lines = highlight('      - uses: upvane/maintenance-action@v1\n          api-key: ${{ secrets.UPVANE_API_KEY }}\n          duration-minutes: 15', 'yaml')
    expect(classOf(lines, 'uses')).toBe('ky')
    expect(classOf(lines, '${{ secrets.UPVANE_API_KEY }}')).toBe('vr')
    expect(classOf(lines, '15')).toBe('nm')
  })

  it('colors shell flags, strings with variables and a multi-line JSON body', () => {
    const source = 'curl https://api.upvane.com/v1/x \\\n  -H "Authorization: Bearer $UPVANE_API_KEY" \\\n  -d \'{\n    "title": "Down",\n    "notify_subscribers": true\n  }\''
    const lines = highlight(source, 'shell')
    expect(classOf(lines, '-H')).toBe('ky')
    expect(classOf(lines, '"Authorization: Bearer ')).toBe('st')
    expect(classOf(lines, '$UPVANE_API_KEY')).toBe('vr')
    expect(classOf(lines, '"title"')).toBe('ky')
    expect(classOf(lines, '"Down"')).toBe('st')
    expect(classOf(lines, 'true')).toBe('nm')
    expect(joined(lines)).toBe(source)
  })

  it('treats # inside a word as text and after a space as a comment', () => {
    const lines = highlight('echo a#b # note', 'shell')
    expect(classOf(lines, 'a#b')).toBe('tx')
    expect(classOf(lines, '# note')).toBe('cm')
  })
})
