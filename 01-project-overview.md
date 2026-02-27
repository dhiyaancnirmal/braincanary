# 01 — Project Overview

## What Is BrainCanary?

BrainCanary is a progressive canary deployment engine for AI agents and LLM applications, powered by Braintrust. It brings the same deployment safety that Argo Rollouts and LaunchDarkly give traditional software — but for AI systems where "broken" means semantically wrong outputs, not HTTP 500s.

You define deployment stages (5% → 25% → 50% → 100%), quality gates (Braintrust eval scores), and rollback thresholds. BrainCanary splits traffic between your baseline and canary versions, monitors real-time quality scores from Braintrust, and automatically promotes or rolls back based on statistical evidence.

## Why Does This Exist?

Every team deploying AI in production faces the same problem: prompt and model changes are scary to ship. A bad prompt returns HTTP 200 with confident, wrong answers. Traditional monitoring sees green. Users see garbage.

Current options:
1. **YOLO deploy** — Ship to 100%, pray, watch Slack for complaints.
2. **Manual gating** — An engineer watches Braintrust logs for 30 minutes. Doesn't scale.
3. **Internal tooling** — Build a custom system. Takes weeks. Every company rebuilds the same thing.

BrainCanary automates the deploy → monitor → promote/rollback cycle using Braintrust eval scores as the quality signal.

## Why Braintrust Specifically?

BrainCanary makes Braintrust the quality oracle that gates every production deployment:

- **Braintrust already has the scores.** Teams have eval scorers (Correctness, Helpfulness, Factuality, custom). BrainCanary reuses them as deployment gates.
- **Braintrust already has the traces.** Every request carries metadata. BrainCanary tags traces with deployment version/stage/ID, queries them via BTQL.
- **Braintrust becomes required infrastructure.** Instead of "nice-to-have observability," Braintrust becomes the critical path that decides whether code ships.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Your Application                        │
│                                                              │
│  const client = braincanary.wrap(openaiClient, deploymentId) │
│  const response = await client.chat.completions.create(...)  │
│                                                              │
└──────────┬───────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│               BrainCanary Proxy (Hono HTTP)                  │
│                                                              │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────┐    │
│  │  Traffic    │   │    Score     │   │     Stage       │    │
│  │  Router    │   │   Monitor    │   │   Controller    │    │
│  │            │   │ (BTQL poll)  │   │ (state machine) │    │
│  └─────┬──────┘   └──────┬───────┘   └────────┬────────┘    │
│        │                 │                     │             │
│  route A or B      query scores        promote / rollback    │
│        │                 │                     │             │
└────────┼─────────────────┼─────────────────────┼─────────────┘
         │                 │                     │
         ▼                 ▼                     │
┌──────────────┐   ┌──────────────┐              │
│   Model      │   │  Braintrust  │◄─────────────┘
│  Providers   │   │  (BTQL API)  │
│  (via        │   │              │
│  wrapOpenAI) │   │  traces +    │
│              │   │  scores +    │
│              │   │  metadata    │
└──────────────┘   └──────────────┘
```

**Critical design decision:** BrainCanary does NOT route through Braintrust's hosted proxy (which explicitly says "not for production, no SLAs"). Instead, it uses `wrapOpenAI()` from the Braintrust SDK — the production-grade instrumentation that Notion, Ramp, Navan actually use — to log traces while routing directly to model providers.

## Monorepo Structure

```
braincanary/
├── packages/
│   ├── core/           # Config, types, state machine, statistics, BTQL client
│   ├── proxy/          # Hono HTTP proxy with traffic splitting
│   ├── cli/            # CLI tool (braincanary deploy/status/rollback)
│   ├── dashboard/      # Single-page React dashboard
│   └── sdk/            # Client wrapper (braincanary.wrap())
├── apps/
│   └── demo/           # Demo agent app for video recording
├── turbo.json
├── package.json
├── tsconfig.base.json
└── README.md
```

## Build Order

1. **Week 1:** `core` — Config parsing (Zod), TypeScript types, state machine, Welch's t-test
2. **Week 2:** `proxy` — Hono server, traffic routing, Braintrust trace tagging via wrapOpenAI
3. **Week 3:** `core` continued — Score monitor (BTQL polling), stage controller, rollback logic
4. **Week 4:** `cli` — Deploy/status/rollback commands, rich terminal output
5. **Week 5:** `dashboard` — Single React page with score charts and stage visualization
6. **Week 6:** `sdk` — Client wrapper, webhook notifications, integration testing
7. **Week 7:** `demo` app, end-to-end testing, demo video recording

## MVP Demo Scope (60-Second Video)

1. Show `braincanary.config.yaml` with baseline/canary/gates defined
2. Run `braincanary deploy` — traffic splits, CLI shows progress
3. Dashboard shows real-time score charts (baseline vs. canary)
4. Simulate bad canary — scores drop — auto-rollback triggers
5. Scores recover, CLI confirms rollback. "Zero user impact."
