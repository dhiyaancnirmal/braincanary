# 11 — Demo Script, Build Plan & Testing Strategy

## Demo Script (60 Seconds — Screen Studio Recording)

### Setup (not shown in video)

A demo app (`apps/demo/`) — simple support agent that answers customer questions. Uses Braintrust for tracing and scoring. Two prompt versions:
- **v2.2 (baseline):** Good prompt, scores ~0.90 on Correctness
- **v2.3 (canary):** Intentionally degraded prompt, scores ~0.65 on Correctness

A traffic simulator (`apps/demo/simulate.ts`) that sends requests to the proxy at configurable rate (e.g., 2 req/s).

### Script

**[0-5s] — Hook**
*Screen: Terminal, dark background*
"Every AI team has shipped a bad prompt to production. BrainCanary makes sure it never reaches your users."

**[5-15s] — Show the config**
*Screen: VS Code with `braincanary.config.yaml` open*
"Define your baseline, canary, traffic stages, and quality gates. BrainCanary uses your existing Braintrust eval scores as deployment gates."
*Highlight: stages section showing 5% → 25% → 50% → 100%*
*Highlight: gates section showing Correctness threshold*

**[15-25s] — Start deployment**
*Screen: Terminal*
```
$ braincanary deploy --config braincanary.config.yaml
```
*Show CLI output: config validated, proxy started, Stage 1 at 5%*
*Cut to: Dashboard showing traffic split donut at 95/5*

**[25-35s] — Scores flowing**
*Screen: Dashboard, score time series chart*
*Traffic simulator running in background — requests flowing through*
"Braintrust scores flow in real-time. Baseline and canary tracked independently."
*Show: Both lines tracking around 0.90 (the "good canary" phase — then switch canary to bad prompt)*

**[35-45s] — Regression detected**
*Screen: Dashboard + CLI side by side*
*Canary scores start dropping on the chart*
*CLI prints: "⚠️ Score regression detected: Correctness 0.91 → 0.65 (p=0.003)"*
*Dashboard: Gate status turns red*
*CLI prints: "🔄 Rolling back..."*
*Dashboard: Traffic split snaps to 100% baseline*

**[45-55s] — Recovery**
*Screen: Dashboard*
*Score chart: canary line gone, baseline line continues steady*
*CLI prints: "✅ Rolled back. Caught at 5% traffic. 95% of users unaffected."*
*Dashboard: Stage progress shows red X on Stage 1*

**[55-60s] — Close**
*Screen: BrainCanary logo + GitHub link*
"BrainCanary. Progressive canary deployments for AI. Built on Braintrust. Open source."
*GitHub URL on screen*

### Key Demo Moments (for Twitter clip)

1. **The score drop** — visible inflection point on the chart where canary diverges from baseline
2. **The auto-rollback** — traffic split animation snapping from 95/5 to 100/0
3. **The CLI message** — "Caught at 5% traffic. 95% of users unaffected."

These three moments compress into a 15-second Twitter clip.

---

## Demo App Architecture

```
apps/demo/
├── src/
│   ├── agent.ts          # Simple support agent (OpenAI SDK)
│   ├── simulate.ts       # Traffic generator (configurable rate)
│   ├── prompts/
│   │   ├── v2.2.txt      # Good prompt
│   │   └── v2.3.txt      # Bad prompt (intentionally degraded)
│   └── questions.json    # Pool of test questions
├── braincanary.config.yaml
└── package.json
```

The demo agent is deliberately simple — it's not the point. The deployment orchestration is the point.

**Traffic simulator:**
```typescript
// apps/demo/src/simulate.ts
const client = new OpenAI({
  baseURL: "http://localhost:4100/v1",  // Points at BrainCanary proxy
  apiKey: process.env.BRAINTRUST_API_KEY,
});

async function simulate(rps: number) {
  const questions = JSON.parse(readFileSync("./questions.json", "utf-8"));
  
  setInterval(async () => {
    const q = questions[Math.floor(Math.random() * questions.length)];
    try {
      await client.chat.completions.create({
        model: "gpt-4o-mini",  // BrainCanary rewrites this per version
        messages: [{ role: "user", content: q }],
      });
    } catch (e) {
      // Log error but don't stop
    }
  }, 1000 / rps);
}
```

---

## Build Plan (7 Weeks)

### Week 1: Foundation (`packages/core`)
- [ ] Monorepo setup (Turborepo, pnpm, TypeScript configs)
- [ ] Config schema (Zod) and loader
- [ ] Duration parser
- [ ] TypeScript types for all domain objects
- [ ] Statistics engine: Welch's t-test, t-distribution CDF, RunningStats
- [ ] Unit tests for statistics (compare against scipy fixtures)
- [ ] SQLite schema and migration runner
- **Deliverable:** `pnpm test` passes. Stats module verified.

### Week 2: Proxy (`packages/proxy`)
- [ ] Hono server scaffolding
- [ ] OpenAI-compatible `/v1/chat/completions` endpoint
- [ ] Traffic router: weighted random selection
- [ ] Session stickiness (hash-based)
- [ ] Braintrust SDK integration: `wrapOpenAI` client initialization
- [ ] Metadata tagging on traces
- [ ] Streaming passthrough (SSE)
- [ ] Internal API endpoints (`/api/status`, `/api/deploy`, etc.)
- **Deliverable:** Proxy routes requests, traces appear in Braintrust with correct metadata.

### Week 3: Monitor + Controller (`packages/core`)
- [ ] BTQL client (query builder, response parser, error handling)
- [ ] Score monitor (polling loop, running stats aggregation)
- [ ] Gate evaluation logic
- [ ] Stage controller (state machine, transitions, guards)
- [ ] SQLite persistence (deployments, transitions, snapshots)
- [ ] Crash recovery logic
- [ ] Event emitter system
- [ ] Webhook notification sender
- **Deliverable:** Full deploy → monitor → promote/rollback lifecycle works end-to-end.

### Week 4: CLI (`packages/cli`)
- [ ] CLI framework setup (citty)
- [ ] `deploy` command (starts daemon, streams events)
- [ ] `status` command (formats JSON response)
- [ ] `promote`, `rollback`, `pause`, `resume` commands
- [ ] `history` command
- [ ] `validate` command
- [ ] Rich terminal output (chalk, cli-table3, ora)
- [ ] Error handling and exit codes
- **Deliverable:** Full CLI experience. Can manage deployments from terminal.

### Week 5: Dashboard (`packages/dashboard`)
- [ ] Vite + React 19 project setup
- [ ] WebSocket connection hook
- [ ] Stage progress component
- [ ] Traffic split donut (Recharts)
- [ ] Gate status cards
- [ ] Score time-series chart (Recharts)
- [ ] Event log component
- [ ] Braintrust deep links
- [ ] Build integration with proxy (static file serving)
- [ ] Dark theme styling (Tailwind)
- **Deliverable:** Dashboard shows real-time deployment data.

### Week 6: SDK + Integration (`packages/sdk`)
- [ ] `braincanary.wrap()` convenience function
- [ ] Integration tests: full deploy → monitor → promote
- [ ] Integration tests: full deploy → detect regression → rollback
- [ ] Edge case tests (no scores, BTQL timeout, crash recovery)
- [ ] Demo app (`apps/demo/`)
- [ ] Traffic simulator
- [ ] README.md (comprehensive, with screenshots)
- **Deliverable:** End-to-end working system. README written.

### Week 7: Polish + Demo
- [ ] Demo rehearsal (run through 3x)
- [ ] Screen Studio recording (60s main video)
- [ ] Twitter clip (15s highlight)
- [ ] GitHub repo setup (license, CI, badges)
- [ ] Final testing pass
- [ ] Tweet draft + cold email draft to Ankur
- **Deliverable:** Published repo, recorded demo, tweet ready.

---

## Testing Strategy

### Unit Tests (Vitest)

**Statistics module** — highest coverage target (>95%)
- Known distributions with pre-computed expected values
- Edge cases (identical scores, single sample, zero variance)
- Comparison against scipy.stats.ttest_ind fixtures

**Config validation**
- Valid configs pass
- Each validation rule has a failure case
- Duration parser edge cases

**State machine**
- Every valid transition
- Every invalid transition (verify rejection)
- Guard conditions (gates passing, duration elapsed, min samples)
- Promotion logic
- Rollback logic

**Gate evaluation**
- Absolute threshold checking
- not_worse_than_baseline comparison
- better_than_baseline comparison
- Insufficient data handling

### Integration Tests

**Full lifecycle (mock Braintrust)**
- Deploy → monitor → promote through all stages → PROMOTED
- Deploy → monitor → detect regression → ROLLING_BACK → ROLLED_BACK
- Deploy → pause → resume → promote
- Crash recovery (kill process, restart, verify resume)

**Braintrust integration (real API, test project)**
- Verify BTQL queries return expected shape
- Verify metadata appears on traces
- Verify scorer names resolve correctly

### E2E Tests

**Demo scenario**
- Start proxy, start traffic simulator
- Verify traces appear in Braintrust
- Verify scores aggregate correctly
- Trigger rollback scenario
- Verify final state

### Test Infrastructure

```
packages/core/test/
├── unit/
│   ├── statistics.test.ts
│   ├── config.test.ts
│   ├── state-machine.test.ts
│   └── gate-evaluation.test.ts
├── integration/
│   ├── lifecycle.test.ts
│   ├── btql-client.test.ts
│   └── crash-recovery.test.ts
└── fixtures/
    ├── scipy-ttest-fixtures.json    # Pre-computed from Python
    ├── valid-configs/
    └── invalid-configs/
```

---

## LOC Estimate

| Package | Estimated LOC | Notes |
|---------|--------------|-------|
| `core` (config, types, state machine, stats, BTQL, events) | ~8,000 | Heavy: statistics, state machine, BTQL client |
| `proxy` (Hono server, routing, streaming, internal API) | ~4,000 | Moderate: proxy plumbing, streaming |
| `cli` (commands, formatting, client) | ~3,000 | Moderate: 8 commands with rich output |
| `dashboard` (React, charts, WebSocket) | ~4,000 | Moderate: single page but several components |
| `sdk` (wrapper, types) | ~1,000 | Light: convenience wrapper |
| `demo` (agent, simulator) | ~1,000 | Light: intentionally simple |
| Tests | ~10,000 | Heavy: statistics fixtures, integration tests |
| Config/tooling (turbo, tsconfig, vite, etc.) | ~1,000 | Boilerplate |
| **Total** | **~32,000** | Exceeds 30k target |

---

## Twitter Strategy

**Main tweet:**
> Built BrainCanary — progressive canary deployments for AI agents, powered by @braborb.
>
> Your bad prompt never reaches more than 5% of users. Auto-rollback in seconds.
>
> [60s demo video]
>
> Open source: [GitHub link]

**Follow-up thread:**
1. "The problem: AI deployments return HTTP 200 with confident wrong answers. Traditional monitoring sees green. Your users see garbage."
2. "BrainCanary uses your @braintrust eval scores as deployment gates. Same scorers you use in dev now gate production traffic."
3. "Technical details: Welch's t-test for statistical significance, finite state machine with crash recovery, real-time BTQL polling. Not an LLM wrapper — real deployment infrastructure."
4. Architecture diagram image

**Tag:** @ankrgyl @braintrust @daRubberDuckiee

**Cold email to Ankur:** Short, link to tweet, mention Trace conference timing, offer to demo live.
