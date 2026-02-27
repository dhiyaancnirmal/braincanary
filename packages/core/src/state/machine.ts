import type { DeploymentLifecycleState, DeploymentSnapshot } from "./types.js";

const ALLOWED: Record<DeploymentLifecycleState, DeploymentLifecycleState[]> = {
  IDLE: ["PENDING"],
  PENDING: ["STAGE", "ROLLING_BACK"],
  STAGE: ["STAGE", "PAUSED", "ROLLING_BACK", "PROMOTED"],
  PAUSED: ["STAGE", "ROLLING_BACK"],
  ROLLING_BACK: ["ROLLED_BACK"],
  ROLLED_BACK: [],
  PROMOTED: []
};

export function assertTransitionAllowed(
  from: DeploymentLifecycleState,
  to: DeploymentLifecycleState
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid transition: ${from} -> ${to}`);
  }
}

export function transitionSnapshot(
  snapshot: DeploymentSnapshot,
  to: DeploymentLifecycleState,
  patch: Partial<DeploymentSnapshot> = {}
): DeploymentSnapshot {
  assertTransitionAllowed(snapshot.state, to);
  return {
    ...snapshot,
    state: to,
    ...patch
  };
}
