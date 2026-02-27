import type { EventEnvelope } from "../types/index";

interface Props {
  events: EventEnvelope[];
}

export function EventLog({ events }: Props) {
  return (
    <div className="panel">
      <h3>Event Log</h3>
      <div className="event-log">
        {events.length === 0 && <div className="small">No events yet.</div>}
        {events.map((event) => (
          <div
            className="event-item"
            key={`${event.deployment_id}-${event.type}-${event.timestamp}`}
          >
            <strong>{event.type}</strong>
            <div className="small">{new Date(event.timestamp).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
