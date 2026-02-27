import type { DeploymentStatusResponse } from "../types/index";

interface Props {
  status: DeploymentStatusResponse;
}

export function GateStatus({ status }: Props) {
  return (
    <div className="panel">
      <h3>Gate Status</h3>
      {(status.gates ?? []).length === 0 && <div className="small">No gate evaluations yet.</div>}
      {(status.gates ?? []).map((gate) => {
        const color = gate.status === "passing" ? "var(--success)" : gate.status === "failing" ? "var(--danger)" : "var(--warning)";
        return (
          <div key={gate.scorer} style={{ borderBottom: "1px solid #1f2c4f", padding: "8px 0" }}>
            <div style={{ fontWeight: 600 }}>{gate.scorer}</div>
            <div className="small">
              baseline {gate.baselineMean.toFixed(3)} · canary {gate.canaryMean.toFixed(3)}
            </div>
            <div style={{ color }}>{gate.status}{gate.pValue !== null ? ` (p=${gate.pValue.toFixed(3)})` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}
