import { useEffect, useMemo, useState } from "react";
import type { DeploymentStatusResponse, EventEnvelope } from "../types/index";

export function useDeployment() {
  const [status, setStatus] = useState<DeploymentStatusResponse | null>(null);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [scoreHistory, setScoreHistory] = useState<Array<Record<string, number | string>>>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;

    const load = async () => {
      const response = await fetch("/api/status");
      const payload = (await response.json()) as DeploymentStatusResponse;
      setStatus(payload);
    };

    void load();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as EventEnvelope;

      if (message.type === "score_update") {
        setStatus((prev) => (prev ? { ...prev, scores: message.data } : prev));
        setScoreHistory((prev) => {
          const flattened: Record<string, number | string> = { t: message.timestamp };
          for (const [scorer, values] of Object.entries(message.data ?? {})) {
            const value = values as any;
            flattened[`${scorer}_baseline`] = value.baseline.mean;
            flattened[`${scorer}_canary`] = value.canary.mean;
          }
          return [...prev, flattened].slice(-200);
        });
      }

      if (message.type === "gate_status") {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                gates: message.data.gates,
                next_action: message.data.next_action,
                time_remaining_ms: message.data.time_remaining_ms
              }
            : prev
        );
      }

      if (message.type === "stage_change") {
        setStatus((prev) =>
          prev && prev.deployment
            ? {
                ...prev,
                deployment: {
                  ...prev.deployment,
                  stage_index: message.data.to,
                  canary_weight: message.data.canary_weight,
                  stage_entered_at: message.timestamp
                }
              }
            : prev
        );
      }

      if (message.type === "deployment_complete") {
        setStatus((prev) =>
          prev && prev.deployment
            ? {
                ...prev,
                deployment: {
                  ...prev.deployment,
                  state: message.data.final_state,
                  canary_weight: message.data.final_state === "ROLLED_BACK" ? 0 : 100
                }
              }
            : prev
        );
      }

      setEvents((prev) => [message, ...prev].slice(0, 50));
    };

    return () => {
      ws?.close();
    };
  }, []);

  const scorers = useMemo(() => Object.keys(status?.scores ?? {}), [status?.scores]);

  return {
    status,
    events,
    scoreHistory,
    scorers
  };
}
