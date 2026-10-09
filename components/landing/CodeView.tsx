import { highlight, type CodeLanguage } from './highlight'

/**
 * Highlighted code rendered on the server. Line numbers come from a CSS counter, so they are never copied or read
 * out. Used by the landing's "as code" tabs and by the docs examples.
 */
export function CodeView({ source, language, numbered = true, className }: { source: string; language: CodeLanguage; numbered?: boolean; className?: string }) {
  const lines = highlight(source, language)
  return (
    <pre className={['lp-code', numbered ? 'numbered' : '', className].filter(Boolean).join(' ')} data-language={language}>
      <code>
        {lines.map((tokens, index) => (
          <span key={index} className="lp-cl">
            {tokens.length === 0
              ? ' '
              : tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} className={`t-${token.cls}`}>
                    {token.text}
                  </span>
                ))}
          </span>
        ))}
      </code>
    </pre>
  )
}
