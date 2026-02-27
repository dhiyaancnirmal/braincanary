# 05 — API & Protocol Specification

## Proxy API (External — App-Facing)

BrainCanary's proxy is fully OpenAI-compatible. Applications point their OpenAI SDK at BrainCanary instead of the provider directly.

### Proxied Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completions (primary) |
| POST | `/v1/completions` | Legacy completions |
| POST | `/v1/embeddings` | Embeddings |

**Behavior:** Each request is intercepted, routed to baseline or canary version, forwarded to the actual model provider via Braintrust's `wrapOpenAI()` client, and returned unchanged. The caller sees no difference from calling the provider directly.

**Headers added by proxy:**
```
X-BrainCanary-Version: baseline|canary
X-BrainCanary-Deployment: <deployment_id>
X-BrainCanary-Stage: <stage_number>
```

**Metadata tagged on Braintrust trace:**
```json
{
  "braincanary.deployment_id": "deploy_abc123",
  "braincanary.deployment_name": "support-agent-v2.3",
  "braincanary.version": "canary",
  "braincanary.stage": 1,
  "braincanary.model": "claude-sonnet-4-5-20250929",
  "braincanary.prompt": "support-agent@v2.3"
}
```

### Streaming Support

BrainCanary transparently proxies SSE streams. No buffering — chunks flow through immediately. The proxy adds metadata tags on the trace after the stream completes (via Braintrust SDK's span finalization).

---

## Internal API (CLI ↔ Proxy Daemon)

The proxy daemon exposes a local HTTP API for the CLI and dashboard.

### `GET /api/status`

Returns current deployment state.

```json
{
  "deployment": {
    "id": "deploy_abc123",
    "name": "support-agent-v2.3",
    "state": "STAGE_2",
    "stage_index": 1,
    "stage_count": 4,
    "canary_weight": 25,
    "started_at": "2026-02-27T10:00:00Z",
    "stage_entered_at": "2026-02-27T10:12:00Z"
  },
  "scores": {
    "baseline": {
      "Correctness": { "mean": 0.91, "std": 0.08, "n": 847 },
      "Helpfulness": { "mean": 0.88, "std": 0.12, "n": 847 }
    },
    "canary": {
      "Correctness": { "mean": 0.93, "std": 0.07, "n": 221 },
      "Helpfulness": { "mean": 0.87, "std": 0.11, "n": 221 }
    }
  },
  "gates": [
    {
      "scorer": "Correctness",
      "status": "passing",
      "p_value": 0.23,
      "confidence_required": 0.95,
      "canary_mean": 0.93,
      "baseline_mean": 0.91
    }
  ],
  "next_action": "auto_promote",
  "time_remaining_ms": 720000
}
```

### `POST /api/deploy`

Start a new deployment. Body: deployment config JSON.

```json
{ "config_path": "./braincanary.config.yaml" }
```

Response: `{ "deployment_id": "deploy_abc123", "state": "STAGE_1" }`

### `POST /api/promote`

Manually promote to next stage.

Response: `{ "state": "STAGE_3", "canary_weight": 50 }`

### `POST /api/rollback`

Immediately rollback.

Response: `{ "state": "ROLLED_BACK", "canary_weight": 0 }`

### `POST /api/pause`

Pause stage timer (hold at current stage indefinitely).

### `POST /api/resume`

Resume stage timer.

### `GET /api/history`

List past deployments.

```json
{
  "deployments": [
    {
      "id": "deploy_abc123",
      "name": "support-agent-v2.3",
      "state": "PROMOTED",
      "started_at": "2026-02-27T10:00:00Z",
      "completed_at": "2026-02-27T12:30:00Z",
      "final_scores": { ... }
    }
  ]
}
```

### `GET /api/events`

SSE stream of deployment events for real-time updates.

```
event: score_update
data: {"version":"canary","scorer":"Correctness","mean":0.93,"n":225}

event: stage_promoted
data: {"from":1,"to":2,"canary_weight":25}

event: rollback_triggered
data: {"reason":"score_regression","scorer":"Correctness","p_value":0.01}
```

---

## WebSocket API (Dashboard)

`ws://localhost:4100/ws`

Dashboard connects and receives the same events as the SSE endpoint, plus periodic score snapshots.

**Message format:**
```json
{
  "type": "score_update" | "stage_change" | "gate_status" | "deployment_complete",
  "timestamp": "2026-02-27T10:15:30Z",
  "data": { ... }
}
```

---

## Braintrust API Usage

### BTQL Queries (Score Monitor)

**Fetch scores for a version within a stage window:**
```sql
SELECT 
  scores,
  metadata,
  created
FROM project_logs('{project_id}', shape => 'traces')
WHERE metadata."braincanary.deployment_id" = '{deployment_id}'
  AND metadata."braincanary.version" = '{version}'
  AND created > '{stage_start_time}'
```

**API call:**
```typescript
const response = await fetch("https://api.braintrust.dev/btql", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: btqlQuery,
    fmt: "json",
  }),
});
```

**Rate limit awareness:** BTQL is rate-limited at 20 req/obj/min. With 30s polling, we use 2 req/min per version (baseline + canary) = 4 req/min total. Well within limits.

### SDK Usage (Trace Logging)

```typescript
import { initLogger, wrapOpenAI } from "braintrust";
import OpenAI from "openai";

const logger = initLogger({
  projectName: config.deployment.project,
  apiKey: process.env.BRAINTRUST_API_KEY,
});

const client = wrapOpenAI(new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}));

// Inside request handler:
return logger.traced(async (span) => {
  span.log({
    metadata: {
      "braincanary.deployment_id": deploymentId,
      "braincanary.version": version,
      "braincanary.stage": stageIndex,
    },
  });
  
  const result = await client.chat.completions.create({
    model: selectedModel,
    messages: request.messages,
    stream: request.stream,
  });
  
  span.log({ input: request.messages, output: result });
  return result;
});
```

### Prompt Loading

```typescript
import { loadPrompt } from "braintrust";

const prompt = await loadPrompt({
  projectName: "support-agent",
  slug: "support-agent",
  version: "v2.3",  // or specific version hash
});

// prompt.build() returns { model, messages, ... } for OpenAI SDK
```

---

## Webhook Payload

```json
{
  "event": "stage_promoted",
  "deployment": {
    "id": "deploy_abc123",
    "name": "support-agent-v2.3",
    "project": "support-agent"
  },
  "stage": {
    "from": 1,
    "to": 2,
    "canary_weight": 25
  },
  "scores": {
    "baseline": { "Correctness": 0.91, "Helpfulness": 0.88 },
    "canary": { "Correctness": 0.93, "Helpfulness": 0.87 }
  },
  "reason": "all_gates_passing",
  "timestamp": "2026-02-27T10:12:00Z"
}
```

**Rollback payload includes:**
```json
{
  "event": "rollback_triggered",
  "reason": "score_regression",
  "details": {
    "scorer": "Correctness",
    "baseline_mean": 0.91,
    "canary_mean": 0.72,
    "p_value": 0.003,
    "absolute_drop": 0.19
  }
}
```
