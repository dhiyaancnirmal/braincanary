import { EventEmitter } from "node:events";
import type { DeploymentEventEnvelope } from "../contracts/events.js";

export class DeploymentEventBus extends EventEmitter {
  emitEvent<T>(event: DeploymentEventEnvelope<T>): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}
