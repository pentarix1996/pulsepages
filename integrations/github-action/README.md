# upvane/maintenance-action

Opens an Upvane maintenance window when a job starts (for example a deploy) and completes it when the job ends, so
your status page and subscribers know what is happening and alerts for the affected components stay quiet.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Opens the window now; the post step completes it when the job ends, even if it fails
      - uses: upvane/maintenance-action@v1
        with:
          api-key: ${{ secrets.UPVANE_API_KEY }}
          project: quillbase
          title: Deploy ${{ github.ref_name }}
          components: payments-api, webhooks
          duration-minutes: 15

      - run: ./scripts/deploy.sh
```

| Input | Default | |
|---|---|---|
| `api-key` | | Write API key (Settings → API keys). Store it as a secret. |
| `project` | | Status page key or id. |
| `title` | | Shown on the status page. |
| `components` | none | Comma-separated component keys shown as under maintenance. |
| `duration-minutes` | `30` | Announced length. The window closes as soon as the job ends, or at this time at the latest. |
| `description` | workflow and repository | What changes and what customers may notice. |
| `notify-subscribers` | `false` | Email and notify subscribers when the window opens and closes. |
| `mute-alerts` | `true` | Mute alerts for the affected components while the window is open. |
| `complete-message` | `The work is done.` | Update posted when the window is completed. |
| `api-url` | `https://api.upvane.com/v1` | For self-hosted Upvane. |
| `fail-on-error` | `false` | Fail the job when Upvane cannot be reached. By default the job continues with a warning. |

Outputs: `maintenance-id` and `url`.

The action has no dependencies (Node 20, `fetch`). It sends an `Idempotency-Key` with every write and retries rate
limits and server errors. From this monorepo it can be used as `<owner>/<repo>/integrations/github-action@<ref>`;
`upvane/maintenance-action` is the published mirror.

```sh
npm test   # node:test
```
