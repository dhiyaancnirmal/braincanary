import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { DeploymentStatusResponse } from "../types/index";

interface Props {
  status: DeploymentStatusResponse;
}

export function TrafficSplit({ status }: Props) {
  const canary = status.deployment?.canary_weight ?? 0;
  const baseline = 100 - canary;

  const data = [
    { name: "baseline", value: baseline, fill: "#22c55e" },
    { name: "canary", value: canary, fill: "#2dd4bf" }
  ];

  return (
    <div className="panel">
      <h3>Traffic Split</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={82} />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="small">
        baseline {baseline}% · canary {canary}%
      </div>
    </div>
  );
}
