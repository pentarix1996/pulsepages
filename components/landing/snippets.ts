// "As code" examples on the landing. Names follow the API contract (sdd/v2-devops-platform/api.md) that the
// Terraform provider (upvane/upvane), the CLI (@upvane/cli) and the GitHub Action (upvane/maintenance-action) use.
import type { CodeLanguage } from './highlight'

export interface Snippet {
  id: string
  label: string
  language: CodeLanguage
  /** What the example does, for the tab panel's accessible description. */
  summary: string
  source: string
}

export const API_BASE_URL = 'https://api.upvane.com/v1'

export const SNIPPETS: readonly Snippet[] = [
  {
    id: 'terraform',
    label: 'Terraform',
    language: 'hcl',
    summary: 'A Terraform monitor that checks the payments health endpoint from three regions.',
    source: `terraform {
  required_providers {
    upvane = { source = "upvane/upvane" }
  }
}

resource "upvane_monitor" "payments" {
  project          = "quillbase"
  name             = "Payments API health"
  type             = "http"
  interval_seconds = 60
  regions          = ["eu-central-1", "us-east-1", "ap-southeast-1"]
  confirm_regions  = 2
  components       = [upvane_component.payments.id]
  config = {
    url = "https://api.quillbase.io/v2/payments/health"
  }
}`,
  },
  {
    id: 'cli',
    label: 'CLI',
    language: 'shell',
    summary: 'Upvane CLI commands that declare an incident, schedule maintenance and report a cron job.',
    source: `npm install -g @upvane/cli

# Declare an incident from your runbook
upvane incidents create \\
  --title "Failed payments in EU and US-East" \\
  --impact major \\
  --component payments-api=major_outage \\
  --message "Payment requests are failing. Retries are safe."

# Announce a maintenance window
upvane maintenance create --title "Postgres upgrade" \\
  --start 2026-10-17T04:00:00Z --end 2026-10-17T04:30:00Z \\
  --component database

# Run a cron job and report it to its heartbeat monitor
upvane heartbeat "$BACKUP_HEARTBEAT_TOKEN" -- ./nightly-backup.sh`,
  },
  {
    id: 'github-action',
    label: 'GitHub Action',
    language: 'yaml',
    summary: 'A GitHub Actions job that opens a maintenance window during a deploy.',
    source: `# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Opens a maintenance window now and completes it when the job ends
      - uses: upvane/maintenance-action@v1
        with:
          api-key: \${{ secrets.UPVANE_API_KEY }}
          project: quillbase
          title: Deploy \${{ github.ref_name }}
          components: payments-api, webhooks
          duration-minutes: 15

      - run: ./scripts/deploy.sh`,
  },
  {
    id: 'curl',
    label: 'curl',
    language: 'shell',
    summary: 'A curl request that declares an incident through the REST API.',
    source: `# Declare an incident and email your subscribers
curl ${API_BASE_URL}/projects/quillbase/incidents \\
  -H "Authorization: Bearer $UPVANE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: payments-outage-1602" \\
  -d '{
    "title": "Failed payments in EU and US-East",
    "status": "investigating",
    "impact": "major",
    "components": { "payments-api": "major_outage" },
    "message": "Payment requests are failing. Retries are safe.",
    "notify_subscribers": true
  }'`,
  },
]

/** Lines of the longest snippet, so the code panel keeps one height while switching tabs. */
export const MAX_SNIPPET_LINES = SNIPPETS.reduce((max, snippet) => Math.max(max, snippet.source.split('\n').length), 0)
