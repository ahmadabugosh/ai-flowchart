# Workflow Architect

A working prototype that turns a written business workflow into a system architecture diagram. It runs with a local deterministic generator by default and can use the OpenAI API when `OPENAI_API_KEY` is configured.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Model provider

ChatGPT Plus/Pro/Team and Codex subscriptions do not currently provide a supported OAuth-style login that lets a custom app make model calls without API billing. This prototype therefore separates the provider layer:

- No secret set: uses the built-in local workflow parser.
- `OPENAI_API_KEY` set: uses the OpenAI Responses API.

Optional environment variables:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
PORT=3000
```

## Deploy to Railway

1. Push this folder to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Railway variables.
4. Railway will run `npm start` and use the provided `PORT`.

## Prototype scope

- Prompt entry for a workflow description.
- Generated architecture nodes, edges, assumptions, and risks.
- SVG rendering with export to SVG and PNG.
- Health check at `/health`.

## References

- ChatGPT and API billing are separate: https://help.openai.com/en/articles/9039756
- Moving a ChatGPT subscription to API billing is not supported directly: https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api
- Codex with ChatGPT plans is for Codex clients, not arbitrary third-party apps: https://help.openai.com/en/articles/11369540
- Structured outputs in the Responses API: https://platform.openai.com/docs/guides/structured-outputs/supported-schemas
