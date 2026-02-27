# 09 — CLI Specification

## Command Overview

```
braincanary <command> [options]

Commands:
  deploy      Start a canary deployment
  status      Show current deployment status
  promote     Manually promote to next stage
  rollback    Immediately rollback to baseline
  pause       Pause the stage timer
  resume      Resume the stage timer
  history     Show past deployments
  validate    Validate config without deploying
```

## Commands

### `braincanary deploy`

Starts the proxy daemon and begins a deployment.

```bash
braincanary deploy --config ./braincanary.config.yaml
```

**Flags:**
- `--config, -c` — Path to config file (default: `./braincanary.config.yaml`)
- `--dry-run` — Validate config and print plan, don't start
- `--detach, -d` — Run daemon in background
- `--verbose, -v` — Debug logging

**Output:**
```
🐤 BrainCanary v0.1.0

  Deployment:  support-agent-v2.3
  Project:     support-agent
  Baseline:    support-agent@v2.2 (claude-sonnet-4-5-20250929)
  Canary:      support-agent@v2.3 (claude-sonnet-4-5-20250929)

  ✓ Config validated
  ✓ Braintrust project found
  ✓ Scorers verified: Correctness, Helpfulness
  ✓ Proxy started on :4100

  Stage 1/4 — 5% canary
  ┌─────────────────────────────────────────────────┐
  │ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5% │
  └─────────────────────────────────────────────────┘
  Monitoring scores every 30s...
  Dashboard: http://localhost:4100/dashboard
```

**Behavior:**
1. Parse and validate config (Zod)
2. Validate against Braintrust API (project exists, scorers exist)
3. Initialize SQLite DB
4. Start Hono proxy server
5. Enter STAGE_1
6. Begin score monitoring loop
7. Stream events to stdout (unless --detach)

### `braincanary status`

Shows current deployment state.

```bash
braincanary status [--json] [--watch]
```

**Flags:**
- `--json` — Output as JSON
- `--watch, -w` — Live-updating display (polls every 5s)
- `--port` — Proxy port to connect to (default: 4100)

**Output:**
```
🐤 BrainCanary — Deployment Status

  Name:     support-agent-v2.3
  State:    STAGE_2 (25% canary)
  Duration: 18m / 30m minimum
  Samples:  baseline=847  canary=221

  Scores:
  ┌──────────────┬──────────┬─────────┬────────┬────────┐
  │ Scorer       │ Baseline │ Canary  │ Δ      │ Gate   │
  ├──────────────┼──────────┼─────────┼────────┼────────┤
  │ Correctness  │ 0.91     │ 0.93    │ +0.02  │ ✅ pass │
  │ Helpfulness  │ 0.88     │ 0.87    │ -0.01  │ ✅ pass │
  └──────────────┴──────────┴─────────┴────────┴────────┘

  ⏳ Auto-promote in ~12m if gates hold
```

**During rollback:**
```
  ⚠️  ROLLING BACK — Score regression detected
  Scorer:    Correctness
  Baseline:  0.91 → Canary: 0.72 (Δ -0.19)
  p-value:   0.003 (confidence: 99.7%)
  Traffic:   → 100% baseline
```

### `braincanary promote`

Manual promotion to next stage.

```bash
braincanary promote [--force]
```

**Flags:**
- `--force` — Promote even if gates aren't passing (skip guard checks)

**Output:**
```
  ✓ Promoted to Stage 3/4 (50% canary)
```

### `braincanary rollback`

Immediate rollback.

```bash
braincanary rollback [--reason "manual: investigating latency spike"]
```

**Output:**
```
  ⚠️  Rolling back...
  ✓ Rolled back. Canary traffic: 0%. Baseline: 100%.
  Reason: manual: investigating latency spike
```

### `braincanary pause` / `braincanary resume`

```bash
braincanary pause
# ⏸ Paused at Stage 2 (25% canary). Timer frozen. Monitoring continues.

braincanary resume
# ▶ Resumed Stage 2. Timer restarting from 18m/30m.
```

### `braincanary history`

```bash
braincanary history [--limit 10]
```

**Output:**
```
  ┌─────────────────────────┬──────────┬─────────┬──────────────────┐
  │ Deployment              │ State    │ Duration│ Date             │
  ├─────────────────────────┼──────────┼─────────┼──────────────────┤
  │ support-agent-v2.3      │ PROMOTED │ 2h 30m  │ 2026-02-27 12:30 │
  │ support-agent-v2.2      │ ROLLBACK │ 8m      │ 2026-02-26 15:45 │
  │ support-agent-v2.1      │ PROMOTED │ 1h 45m  │ 2026-02-25 09:00 │
  └─────────────────────────┴──────────┴─────────┴──────────────────┘
```

### `braincanary validate`

```bash
braincanary validate --config ./braincanary.config.yaml
```

**Output on success:**
```
  ✓ Config valid
  ✓ 4 stages defined (5% → 25% → 50% → 100%)
  ✓ 2 scorers referenced: Correctness, Helpfulness
  ✓ Rollback threshold: 10% score drop
```

**Output on failure:**
```
  ✗ Invalid config:
    deployment.stages: Stage weights must be strictly increasing
    deployment.canary.model: Required
```

## Implementation

### Technology
- **CLI framework:** citty (lightweight, TypeScript-first, UnJS ecosystem)
- **Colors/styling:** chalk v5 (ESM)
- **Tables:** cli-table3
- **Spinners:** ora (for async operations like config validation)
- **Communication:** HTTP calls to proxy daemon at `localhost:{port}/api/*`

### Architecture

The CLI is a thin client. All state lives in the proxy daemon. The CLI just:
1. Sends HTTP requests to the daemon's internal API
2. Formats the JSON responses for terminal display
3. For `deploy`: also starts the daemon process (or connects to existing)

```typescript
// packages/cli/src/client.ts
export class BrainCanaryClient {
  constructor(private baseUrl: string = "http://localhost:4100") {}

  async getStatus() {
    const res = await fetch(`${this.baseUrl}/api/status`);
    return res.json();
  }

  async promote(force = false) {
    const res = await fetch(`${this.baseUrl}/api/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    return res.json();
  }

  async rollback(reason?: string) {
    const res = await fetch(`${this.baseUrl}/api/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.json();
  }
  
  // ... pause, resume, history
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (deployed, promoted, etc.) |
| 1 | Config validation error |
| 2 | Braintrust connection/auth error |
| 3 | Deployment rolled back (canary failed) |
| 4 | Daemon not running / connection refused |
