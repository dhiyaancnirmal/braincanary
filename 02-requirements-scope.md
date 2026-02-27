# 02 — Requirements & Scope

## What We Are Building

BrainCanary: a progressive canary deployment engine for AI agents that uses Braintrust eval scores as quality gates for automated promote/rollback decisions.

### Functional Requirements

**FR-1: Deployment Configuration**
- YAML config defining baseline version, canary version, traffic stages, quality gates, rollback conditions
- Reference Braintrust project names, prompt slugs, scorer names
- Zod schema validation with helpful error messages on invalid config

**FR-2: Traffic Routing**
- HTTP proxy accepting OpenAI-compatible requests
- Weighted random routing between baseline and canary based on current stage
- Session stickiness via configurable request metadata hash (e.g., user_id)
- Transparent streaming passthrough
- Trace tagging: every request gets `braincanary.deployment_id`, `braincanary.version` (baseline|canary), `braincanary.stage` metadata via Braintrust SDK

**FR-3: Score Monitoring**
- Poll Braintrust BTQL API on configurable interval (default 30s)
- Aggregate scores per version per scorer for the current stage window
- Compute Welch's t-test for baseline vs. canary comparison
- Detect absolute score drops below threshold
- Detect relative score regression vs. baseline at configurable confidence level

**FR-4: Stage Controller**
- State machine: PENDING → STAGE_N → PROMOTED | ROLLING_BACK → ROLLED_BACK
- Gate evaluation: all gates passing + minimum duration elapsed + minimum sample size
- Rollback triggers: gate failing with sufficient confidence, absolute score threshold breach, error rate exceeded
- State persistence to SQLite for crash recovery
- Audit log of all state transitions

**FR-5: CLI**
- `braincanary deploy --config <path>` — start deployment
- `braincanary status` — current deployment state, scores, stage progress
- `braincanary promote` — skip to next stage (manual override)
- `braincanary rollback` — immediate rollback
- `braincanary pause` / `braincanary resume` — freeze/resume stage timer
- `braincanary history` — past deployments
- Rich terminal output with colors, tables, progress indicators

**FR-6: Dashboard**
- Single-page web UI served by the proxy daemon
- Traffic split donut chart (% baseline vs. canary)
- Score time-series line chart per scorer (baseline vs. canary with confidence bands)
- Stage progression pipeline visualization
- Event log (promotions, rollbacks, gate status changes)
- Deep links to Braintrust trace viewer

**FR-7: Notifications**
- Webhook notifications on: stage_promoted, rollback_triggered, deployment_complete, gate_failing
- JSON payload with deployment context, scores, reason
- Configurable in YAML

**FR-8: Multi-Model Support**
- Canary can change model (not just prompt): e.g., baseline=claude-sonnet, canary=claude-haiku
- Router rewrites model parameter per version
- Score comparison accounts for expected cost differences

### Non-Functional Requirements

**NFR-1:** Proxy adds < 5ms p99 latency to requests (excluding model provider latency)
**NFR-2:** Score monitor handles up to 10,000 traces per stage window
**NFR-3:** State machine recovers from crash within 5 seconds of restart
**NFR-4:** Dashboard loads in < 2 seconds, updates in real-time via WebSocket
**NFR-5:** Config validation fails fast with actionable error messages
**NFR-6:** Zero data loss — all traces reach Braintrust even if BrainCanary crashes (guaranteed by Braintrust SDK's async flush)

## What We Are NOT Building

- **Not a Braintrust replacement.** BrainCanary doesn't score, trace, or store data. It orchestrates deployments using Braintrust's APIs.
- **Not a model router/optimizer.** We don't pick the "best" model per request (that's Martian/RouteLLM territory). We split traffic between two known versions.
- **Not a feature flag system.** No user targeting, segmentation, or gradual feature rollouts beyond A/B prompt/model versions.
- **Not a CI/CD pipeline.** BrainCanary manages the deployment window, not the build/test/merge pipeline. It integrates with CI/CD (GitHub Actions) but doesn't replace it.
- **Not an eval framework.** We don't define or run scorers. We consume scores that Braintrust already computes.
- **Not multi-tenant SaaS.** Single-org, single-proxy deployment. No auth system, no billing.
- **Not a UI-heavy product.** The dashboard is one page. The primary interface is the CLI.

## Target User

Platform/infra engineers at AI-native companies who own the deployment pipeline for LLM features. The same person who adopted Argo Rollouts, LaunchDarkly, or Vercel's preview deployments for traditional software. They already use Braintrust for observability and want deployment automation on top.

## Success Criteria

1. Working end-to-end demo: deploy canary → detect regression → auto-rollback (captured in < 60s video)
2. Open-source on GitHub with comprehensive README
3. Config schema that a Braintrust user can fill out in < 5 minutes
4. Codebase passes 30k+ LOC threshold with real engineering (no filler)
