/**
 * A script that runs while the HTML is parsed (hard loads) and is inert when React renders it on the client (soft
 * navigations), which avoids React's warning about scripts. Used to correct theme and times before the first paint.
 */
export function InlineScript({ code }: { code: string }) {
  return <script type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />
}

/** JSON for embedding in an inline script: `<` is escaped so a value can never close the script element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029')
}
