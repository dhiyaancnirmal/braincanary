import type { DeploymentStatusResponse } from "../types/index";

interface Props {
  status: DeploymentStatusResponse;
}

export function StageProgress({ status }: Props) {
  const deployment = status.deployment;
  if (!deployment) return null;

  const stages = Array.from({ length: deployment.stage_count }, (_, idx) => idx);
  const percent = status.time_remaining_ms && status.time_remaining_ms > 0
    ? Math.max(5, Math.min(100, 100 - status.time_remaining_ms / 600))
    : 100;

  return (
    <div className="panel">
      <h3>Stage Progress</h3>
      <div className="stage-row">
        {stages.map((idx) => {
          const done = idx < deployment.stage_index;
          const current = idx === deployment.stage_index;
          const key = `stage-${idx + 1}`;
          return (
            <div
              key={key}
              className={`stage-pill ${done ? "done" : ""} ${current ? "current" : ""}`.trim()}
            >
              {idx + 1} {done ? "✓" : current ? "⏳" : "•"}
            </div>
          );
        })}
      </div>
      <div className="progress" aria-label="stage-timer-progress">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
