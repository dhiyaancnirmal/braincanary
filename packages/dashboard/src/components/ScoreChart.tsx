import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

interface Props {
  scoreHistory: Array<Record<string, number | string>>;
  scorers: string[];
}

export function ScoreChart({ scoreHistory, scorers }: Props) {
  return (
    <div className="panel">
      <h3>Score Time Series</h3>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={scoreHistory}>
            <CartesianGrid stroke="#1d2a4b" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              tick={{ fill: "#90a4d4", fontSize: 12 }}
              tickFormatter={(value) => new Date(String(value)).toLocaleTimeString()}
            />
            <YAxis domain={[0, 1]} tick={{ fill: "#90a4d4", fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {scorers.flatMap((scorer, idx) => {
              const color = idx % 2 === 0 ? "#2dd4bf" : "#f59e0b";
              return [
                <Line
                  key={`${scorer}-baseline`}
                  type="monotone"
                  dataKey={`${scorer}_baseline`}
                  name={`${scorer} baseline`}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                />,
                <Line
                  key={`${scorer}-canary`}
                  type="monotone"
                  dataKey={`${scorer}_canary`}
                  name={`${scorer} canary`}
                  stroke={color}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  dot={false}
                />
              ];
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
