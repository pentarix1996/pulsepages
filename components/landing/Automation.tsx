import Link from 'next/link'
import { CodeTabs } from './CodeTabs'
import { CodeView } from './CodeView'
import { SectionIntro } from './parts'
import { MAX_SNIPPET_LINES, SNIPPETS } from './snippets'

export function Automation() {
  const tabs = SNIPPETS.map((snippet) => ({
    id: snippet.id,
    label: snippet.label,
    source: snippet.source,
    summary: snippet.summary,
    panel: <CodeView source={snippet.source} language={snippet.language} />,
  }))
  return (
    <section id="automation" className="lp-wrap lp-section" aria-labelledby="automation-title">
      <div className="lp-split">
        <SectionIntro
          id="automation-title"
          title="Your pipeline already knows when you deploy."
          lede="Open a maintenance window from CI, keep monitors next to the rest of your infrastructure code, and post incident updates from a script. The API covers status pages, components, monitors, alert routing, incidents and maintenance."
        >
          <div className="lp-chips">
            <Link className="lp-chip" href="/docs/api">
              REST API with OpenAPI spec
            </Link>
            <span className="lp-chip">Terraform provider</span>
            <span className="lp-chip">GitHub Action</span>
            <span className="lp-chip">CLI</span>
          </div>
          <p className="lp-note">The API, Terraform provider, CLI and GitHub Action are included in Pro and Business.</p>
        </SectionIntro>
        <CodeTabs tabs={tabs} label="Examples" minLines={MAX_SNIPPET_LINES} />
      </div>
    </section>
  )
}
