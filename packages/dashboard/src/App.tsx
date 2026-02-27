import { useDeployment } from "./hooks/useDeployment";
import { EventLog } from "./components/EventLog";
import { GateStatus } from "./components/GateStatus";
import { ScoreChart } from "./components/ScoreChart";
import { StageProgress } from "./components/StageProgress";
import { TrafficSplit } from "./components/TrafficSplit";

export function App() {
  const { status, events, scoreHistory, scorers } = useDeployment();

  if (!status || !status.deployment) {
    return (
      <div className="dashboard">
        <div className="header">
          <div>🐤 BrainCanary</div>
          <div className="badge">IDLE</div>
        </div>
        <div className="panel">No active deployment.</div>
      </div>
    );
  }

  const stateClass = status.deployment.state.includes("ROLL") ? "danger" : "safe";
  const deploymentId = status.deployment.id;

  return (
    <div className="dashboard">
      <header className="header">
        <div>
          <div>🐤 BrainCanary</div>
          <div className="small">{status.deployment.name}</div>
        </div>
        <div className={`badge ${stateClass}`}>{status.deployment.state}</div>
      </header>

      <StageProgress status={status} />

      <section className="grid-2">
        <TrafficSplit status={status} />
        <GateStatus status={status} />
      </section>

      <ScoreChart scoreHistory={scoreHistory} scorers={scorers} />
      <EventLog events={events} />

      <div className="panel">
        <a
          className="link"
          href={`https://www.braintrust.dev/app/logs?filter=metadata.braincanary.deployment_id%3D%22${encodeURIComponent(
            deploymentId
          )}%22`}
          target="_blank"
          rel="noreferrer"
        >
          View in Braintrust
        </a>
      </div>
    </div>
  );
}
