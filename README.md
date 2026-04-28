# Workflow Architect

A working prototype that turns a written business workflow into a system architecture/flowchart diagram. It runs with a local deterministic generator by default and can use the OpenAI API globally or per user.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Model provider

ChatGPT Plus/Pro/Team and Codex subscriptions do not currently provide a supported OAuth-style login that lets a custom app make model calls without API billing. This prototype therefore separates the provider layer:

- No OpenAI key set: uses the built-in local workflow parser.
- `OPENAI_API_KEY` set: uses the OpenAI Responses API globally.
- Logged-in user key set from Settings: uses that user's OpenAI API key.

Optional environment variables:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
APP_SECRET=change-me-to-a-long-random-secret
DATA_DIR=/tmp/workflow-architect-data
LOOPS_API_KEY=...
LOOPS_TRANSACTIONAL_ID=...
PORT=3000
```

## Login and Settings

The app supports passwordless login with one-time codes:

- The app creates and verifies the code.
- Loops sends the code using a transactional email template.
- The Loops template should include a `{code}` data variable.

Required Railway variables for live email login:

- `LOOPS_API_KEY`
- `LOOPS_TRANSACTIONAL_ID`
- `APP_SECRET`

When Loops is not configured, `/api/auth/request-code` returns a development code in the response so local testing still works.

After login, users can save their own OpenAI API key and model from Settings. User keys are encrypted with `APP_SECRET` before being stored. Keep `APP_SECRET` stable across deploys or saved user keys and sessions will become unreadable.

## Deploy to Railway

1. Push this folder to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add `APP_SECRET`, `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_ID`, and optionally `OPENAI_API_KEY` / `OPENAI_MODEL` in Railway variables.
4. Railway will run `npm start` and use the provided `PORT`.

## Prototype scope

- Passwordless login with Loops transactional email support.
- Settings page for per-user OpenAI API key and model.
- Prompt entry for a workflow description.
- Generated swimlane flowcharts with process rectangles, decision diamonds, document shapes, database cylinders, external systems, terminators, labeled branches, assumptions, and risks.
- SVG rendering with export to SVG and PNG.
- Health check at `/health`.

## References

- ChatGPT and API billing are separate: https://help.openai.com/en/articles/9039756
- Moving a ChatGPT subscription to API billing is not supported directly: https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api
- Codex with ChatGPT plans is for Codex clients, not arbitrary third-party apps: https://help.openai.com/en/articles/11369540
- Structured outputs in the Responses API: https://platform.openai.com/docs/guides/structured-outputs/supported-schemas
