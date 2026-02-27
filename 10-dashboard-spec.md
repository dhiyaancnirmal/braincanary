# 10 — Dashboard Specification

## Overview

Single-page React application. No authentication, no routing. One screen showing everything about the current deployment. Served by the proxy at `/dashboard`.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🐤 BrainCanary           support-agent-v2.3    ● STAGE 2  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── Stage Progress ────────────────────────────────────┐  │
│  │  ① 5% ✅  →  ② 25% ⏳  →  ③ 50%  →  ④ 100%         │  │
│  │              ████████░░░░ 18m / 30m                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─── Traffic Split ──┐  ┌─── Gate Status ─────────────┐   │
│  │                     │  │                              │   │
│  │   ┌─────────────┐  │  │  Correctness                │   │
│  │   │  ████████   │  │  │  baseline: 0.91  canary: 0.93│   │
│  │   │  ████████   │  │  │  ✅ passing (p=0.23)         │   │
│  │   │  ██░░░░░░   │  │  │                              │   │
│  │   └─────────────┘  │  │  Helpfulness                 │   │
│  │   75% baseline     │  │  baseline: 0.88  canary: 0.87│   │
│  │   25% canary       │  │  ✅ passing (p=0.41)         │   │
│  │                     │  │                              │   │
│  └─────────────────────┘  └──────────────────────────────┘  │
│                                                             │
│  ┌─── Score Time Series ─────────────────────────────────┐  │
│  │  1.0 ─┬──────────────────────────────────────────     │  │
│  │       │  ___baseline (Correctness)___                 │  │
│  │  0.9 ─┤  ===canary (Correctness)====                  │  │
│  │       │                                               │  │
│  │  0.8 ─┤  ___baseline (Helpfulness)___                 │  │
│  │       │  ===canary (Helpfulness)====                   │  │
│  │  0.7 ─┤                                               │  │
│  │       └──┬──────┬──────┬──────┬──────┬──────┬─────    │  │
│  │        10:00  10:05  10:10  10:15  10:20  10:25       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─── Event Log ─────────────────────────────────────────┐  │
│  │  10:12  ✅ Promoted to Stage 2 (25% canary)           │  │
│  │  10:10  📊 Gate check: all passing (n=52)             │  │
│  │  10:05  📊 Gate check: insufficient data (n=12)       │  │
│  │  10:00  🚀 Deployment started — Stage 1 (5%)          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  View in Braintrust →  [deep link to project logs]          │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Header Bar
- BrainCanary logo (bird emoji + name)
- Deployment name
- Current state badge (color-coded: green=active, red=rollback, blue=promoted)

### 2. Stage Progress
- Horizontal pipeline showing all stages
- Current stage highlighted with progress bar (time elapsed / duration)
- Completed stages have checkmark, future stages are greyed out
- If rolled back: all stages show red X

### 3. Traffic Split
- Donut chart or stacked bar showing baseline % vs. canary %
- Updates on stage change
- Library: Recharts `<PieChart>` or `<BarChart>`

### 4. Gate Status
- Card per scorer
- Shows baseline mean, canary mean, delta
- Pass/fail indicator with p-value
- Color: green (passing), yellow (insufficient data), red (failing)
- Confidence band visualization (optional)

### 5. Score Time Series
- Line chart with time on X-axis, score (0-1) on Y-axis
- One line per version per scorer (baseline solid, canary dashed)
- Confidence bands as shaded area (optional post-MVP)
- Stage boundaries shown as vertical dashed lines
- Library: Recharts `<LineChart>` with `<Line>`, `<ReferenceLine>`

### 6. Event Log
- Reverse-chronological list of deployment events
- Color-coded icons per event type
- Scrollable, max ~50 items
- Each event links to relevant Braintrust trace (if applicable)

### 7. Deep Link
- Link to Braintrust project logs filtered by `metadata.braincanary.deployment_id`
- Format: `https://www.braintrust.dev/app/{org}/p/{project}/logs?filter=metadata.braincanary.deployment_id%3D%22{id}%22`

## Tech Stack

- **React 19** — functional components, hooks
- **Vite** — build tool, dev server
- **Recharts** — charts (already used in Braintrust ecosystem)
- **Tailwind CSS** — utility-first styling (minimal custom CSS)
- **WebSocket** — native browser WebSocket to `/ws`

## Data Flow

```typescript
// packages/dashboard/src/hooks/useDeployment.ts

export function useDeployment() {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([]);

  useEffect(() => {
    // Initial fetch
    fetch("/api/status").then(r => r.json()).then(setStatus);

    // WebSocket for real-time updates
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case "score_update":
          setStatus(prev => ({ ...prev, scores: msg.data }));
          setScoreHistory(prev => [
            ...prev,
            { timestamp: msg.timestamp, ...flattenScores(msg.data) }
          ]);
          break;
        case "stage_change":
          setStatus(prev => ({ ...prev, ...msg.data }));
          setEvents(prev => [msg, ...prev].slice(0, 50));
          break;
        case "gate_status":
          setStatus(prev => ({ ...prev, gates: msg.data }));
          break;
        case "deployment_complete":
          setStatus(prev => ({ ...prev, state: msg.data.final_state }));
          setEvents(prev => [msg, ...prev].slice(0, 50));
          break;
      }
    };

    return () => ws.close();
  }, []);

  return { status, events, scoreHistory };
}
```

## Build & Serving

The dashboard is built at package build time and bundled as static files:

```typescript
// In proxy server (packages/proxy/src/server.ts)
import { serveStatic } from "@hono/node-server/serve-static";

app.use("/dashboard/*", serveStatic({
  root: "./node_modules/@braincanary/dashboard/dist",
  rewriteRequestPath: (path) => path.replace("/dashboard", ""),
}));
```

**Build:** `vite build` outputs to `packages/dashboard/dist/`

## Design Principles

1. **Information density over aesthetics** — This is a deployment tool, not a marketing page. Every pixel shows useful data.
2. **Real-time first** — WebSocket updates, no manual refresh needed.
3. **Color = signal** — Green (safe), yellow (waiting), red (danger). No decorative color.
4. **One page** — No navigation, no routing. Everything visible at once.
5. **Deep link to Braintrust** — Dashboard shows the summary; Braintrust has the details.
6. **Dark theme** — Engineers run this in terminals. Dark mode default, no toggle.

## Rollback State UI

When a rollback occurs, the dashboard transforms:
- Stage progress shows red X on the failed stage
- Traffic split snaps to 100% baseline
- A prominent red banner appears: "⚠️ Rollback triggered — [reason]"
- Score chart shows the drop point highlighted
- Event log shows rollback event at top
