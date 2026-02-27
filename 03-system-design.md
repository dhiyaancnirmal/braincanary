# 03 — System Design

## Architecture Diagram

```
                    ┌────────────────────────────┐
                    │       User's App           │
                    │                            │
                    │  OpenAI SDK pointed at      │
                    │  localhost:4100 (BrainCanary)│
                    └─────────────┬──────────────┘
                                  │
                         HTTP POST /v1/chat/completions
                                  │
                    ┌─────────────▼──────────────┐
                    │    BrainCanary Proxy        │
                    │    (Hono on Node.js)        │
                    │                            │
                    │  ┌────────────────────┐    │
                    │  │  Request Interceptor│    │
                    │  │  - Read deployment  │    │
                    │  │  - Pick version     │    │
                    │  │  - Tag metadata     │    │
                    │  └─────────┬──────────┘    │
                    │            │               │
                    │     ┌──────┴──────┐        │
                    │     │             │        │
                    │  baseline      canary      │
                    │  (95%)        (5%)         │
                    │     │             │        │
                    │     ▼             ▼        │
                    │  ┌─────────────────────┐   │
                    │  │  wrapOpenAI Client   │   │
                    │  │  (Braintrust SDK)    │   │
                    │  │  → tags metadata     │   │
                    │  │  → calls provider    │   │
                    │  │  → logs trace        │   │
                    │  └─────────────────────┘   │
                    │            │               │
                    │            ▼               │
                    │  ┌──────────────────┐      │
                    │  │  Response Stream  │      │
                    │  │  → passthrough    │      │
                    │  └──────────────────┘      │
                    └────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │ OpenAI /     │    │   Braintrust     │    │   SQLite DB      │
  │ Anthropic /  │    │   Platform       │    │   (local state)  │
  │ Google APIs  │    │                  │    │                  │
  │              │    │  - Traces logged │    │  - Deployment    │
  │ (direct)     │    │  - Online scores │    │    state         │
  └──────────────┘    │  - BTQL queries  │    │  - Stage history │
                      │                  │    │  - Audit log     │
                      └──────────────────┘    └──────────────────┘
                               ▲
                               │
                    ┌──────────┴──────────┐
                    │   Score Monitor     │
                    │   (background loop) │
                    │                     │
                    │  Every 30s:         │
                    │  1. BTQL query for  │
                    │     scores by       │
                    │     version         │
                    │  2. Welch's t-test  │
                    │  3. Emit events     │
                    │     to Stage        │
                    │     Controller      │
                    └─────────────────────┘
```

## Component Responsibilities

### 1. Proxy Server (`packages/proxy`)
- Hono HTTP server on configurable port (default 4100)
- Accepts OpenAI-compatible `/v1/chat/completions` (and `/v1/completions`, `/v1/embeddings`)
- For each request: determines version (baseline|canary), rewrites model/prompt if needed, forwards to provider via Braintrust-wrapped OpenAI client
- Tags every trace with BrainCanary metadata
- Serves dashboard static files on `/dashboard`
- WebSocket endpoint `/ws` for real-time dashboard updates
- Internal HTTP API on `/api/` for CLI communication

### 2. Traffic Router (`packages/core/router.ts`)
- Reads current deployment state (stage, weights)
- Weighted random selection: Math.random() < canaryWeight → canary, else baseline
- Optional session stickiness: hash(request.metadata[stickyKey]) % 100 < canaryWeight
- Returns routing decision: `{ version: 'baseline' | 'canary', model: string, prompt?: string }`

### 3. Score Monitor (`packages/core/monitor.ts`)
- Runs on configurable interval (default 30s)
- Queries Braintrust BTQL: `SELECT scores.*, metadata FROM project_logs('{projectId}') spans WHERE metadata."braincanary.deployment_id" = '{id}' AND metadata."braincanary.version" = '{version}' AND created > '{stageStartTime}'`
- Aggregates scores per scorer per version
- Computes Welch's t-test between baseline and canary score distributions
- Emits typed events: `ScoreUpdate`, `GatePassing`, `GateFailing`, `InsufficientData`, `ScoreDropDetected`

### 4. Stage Controller (`packages/core/controller.ts`)
- Finite state machine with typed transitions
- Listens to Score Monitor events
- Promotion logic: ALL gates passing AND duration elapsed AND minimum samples reached
- Rollback logic: ANY gate failing at configured confidence OR absolute threshold breach OR error rate exceeded
- Persists state to SQLite after every transition
- On startup: reads last state from SQLite, resumes monitoring
- Emits events for CLI/dashboard/webhooks: `StagePromoted`, `RollbackTriggered`, `DeploymentComplete`

### 5. CLI (`packages/cli`)
- Thin client that calls BrainCanary proxy's internal HTTP API
- `braincanary deploy` starts the proxy daemon with config
- `braincanary status` polls `/api/status`
- `braincanary rollback` calls `POST /api/rollback`
- Rich output via chalk + cli-table3

### 6. Dashboard (`packages/dashboard`)
- React 19 + Vite single-page app
- Bundled into proxy at build time, served at `/dashboard`
- Connects to `/ws` WebSocket for real-time score updates
- Recharts for time-series charts
- No authentication (local tool)

### 7. SDK Wrapper (`packages/sdk`)
- Convenience function: `braincanary.wrap(openaiClient, { port, deploymentId })`
- Rewrites `baseURL` to point at BrainCanary proxy
- Adds deployment metadata headers

## Data Flow: Request Lifecycle

1. App calls `client.chat.completions.create({ model: "claude-sonnet-4-5-20250929", messages: [...] })`
2. Request hits BrainCanary proxy at `localhost:4100/v1/chat/completions`
3. Router picks version (baseline 95%, canary 5%)
4. If canary: may rewrite `model` field or load different prompt via `loadPrompt()`
5. Proxy calls actual provider via `wrapOpenAI` client, which:
   a. Makes the real API call to OpenAI/Anthropic/Google
   b. Automatically logs the full trace to Braintrust with metadata tags
6. Response streams back to the app unchanged
7. In background, Score Monitor polls BTQL every 30s for new scores
8. Stage Controller evaluates gates and decides promote/hold/rollback
9. If rollback: Router immediately sets canary weight to 0%
10. Dashboard and CLI reflect state changes in real-time via WebSocket/polling

## Technology Decisions

| Decision | Choice | Rationale | Rejected Alternatives |
|----------|--------|-----------|----------------------|
| HTTP framework | Hono 4.x | Lightweight (12kB), fast, built on Web Standards, great TypeScript support. Handles streaming natively. | Fastify (heavier plugin system, overkill for a proxy), Express (slow, no native streaming) |
| State persistence | better-sqlite3 | Zero-config embedded DB, synchronous API (simpler state machine), single file. No external dependencies. | PostgreSQL (requires running DB), Redis (overkill for single-process state), flat JSON file (no ACID, corruption risk) |
| Statistics | Custom implementation | Welch's t-test is ~50 lines of math. No need for a statistics library dependency for one formula. | jstat (large bundle, mostly unused), simple-statistics (unnecessary dependency) |
| Dashboard charts | Recharts | React-native, well-maintained, handles time-series well. Already in Braintrust's ecosystem. | Chart.js (not React-native), D3 (too low-level), Plotly (heavy) |
| CLI framework | citty | Lightweight, TypeScript-first, from UnJS ecosystem. Clean API. | commander (verbose), yargs (complex), oclif (too heavy for 6 commands) |
| Monorepo | Turborepo | Fast builds, good TypeScript support, simple config. Industry standard. | Nx (overkill), pnpm workspaces alone (no build caching), Lerna (deprecated patterns) |
| Package manager | pnpm | Fast, strict, good monorepo support. | npm (slow, flat node_modules), yarn (less strict) |
| Braintrust integration | `braintrust` SDK + `@braintrust/api` REST client | SDK for tracing (wrapOpenAI), REST client for BTQL queries. Official, maintained, typed. | Raw HTTP calls (no types, more code), braintrust-proxy (not for production) |
