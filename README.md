# BrainCanary

Progressive canary deployments for AI applications, powered by Braintrust traces and scores.

BrainCanary lets you ship prompt/model changes with controlled traffic ramps (5% → 25% → 50% → 100%), statistical quality gates, and automatic rollback when canary quality regresses.

## Highlights

- OpenAI-compatible proxy endpoints (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`)
- Dual runtime modes:
  - `direct`: route directly to providers with Braintrust instrumentation
  - `gateway`: route via Braintrust Gateway
- Stage controller with finite-state deployment lifecycle
- BTQL-backed score monitor and gate evaluation (Welch’s t-test)
- Manual controls via CLI (`deploy`, `status`, `promote`, `rollback`, `pause`, `resume`, `history`, `validate`)
- Real-time dashboard with traffic split, gate status, score trends, and event log
- SQLite persistence for crash recovery
- Webhook notifications for rollout events

## Monorepo Packages

- `packages/core` — config schema, contracts, statistics, monitor, controller, persistence
- `packages/proxy` — Hono proxy daemon + internal control APIs + SSE/WS events
- `packages/cli` — operational CLI for managing deployments
- `packages/dashboard` — React dashboard served at `/dashboard`
- `packages/sdk` — client helper wrappers
- `apps/demo` — demo support-agent traffic simulator

## Quickstart

### 1) Install and build

```bash
pnpm install
pnpm build
```

### 2) Start proxy daemon

```bash
pnpm --filter @braincanary/proxy dev
```

### 3) Validate and deploy demo config

```bash
pnpm --filter @braincanary/cli dev validate --config apps/demo/braincanary.config.yaml
pnpm --filter @braincanary/cli dev deploy --config apps/demo/braincanary.config.yaml
```

### 4) Open dashboard

- [http://127.0.0.1:4100/dashboard](http://127.0.0.1:4100/dashboard)

## Environment Variables

- `BRAINTRUST_API_KEY` (required for Braintrust queries/instrumentation)
- Provider key for direct mode (for example `OPENAI_API_KEY`)
- Optional:
  - `BRAINCANARY_HOST` (default `127.0.0.1`)
  - `BRAINCANARY_PORT` (default `4100`)
  - `BRAINCANARY_DB_PATH` (default `./braincanary.db`)

## CLI Commands

```bash
braincanary deploy --config <path>
braincanary status [--watch] [--json]
braincanary promote [--force]
braincanary rollback [--reason "..."]
braincanary pause
braincanary resume
braincanary history [--limit 10]
braincanary validate --config <path>
```

## Notes

- `pnpm build` and `pnpm test` are wired at workspace level.
- Some environments may not have native `better-sqlite3` bindings prebuilt; tests are written to avoid false negatives in that case.

## License

MIT (add `LICENSE` file if you want to publish publicly with an explicit license).
