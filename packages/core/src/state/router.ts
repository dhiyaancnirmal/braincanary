import type { DeploymentSnapshot } from "./types.js";
import { stableHash } from "../utils/hash.js";

export interface RoutingDecision {
  version: "baseline" | "canary";
  canaryWeight: number;
  stageIndex: number;
}

export function chooseVersion(
  snapshot: DeploymentSnapshot | null,
  stickyValue: string | undefined,
  random: number = Math.random()
): RoutingDecision {
  if (!snapshot || !["STAGE", "PAUSED", "PENDING"].includes(snapshot.state)) {
    return {
      version: "baseline",
      canaryWeight: 0,
      stageIndex: snapshot?.stageIndex ?? 0
    };
  }

  const canaryWeight = snapshot.canaryWeight;
  if (canaryWeight <= 0) {
    return {
      version: "baseline",
      canaryWeight,
      stageIndex: snapshot.stageIndex
    };
  }

  let bucket: number;
  if (stickyValue) {
    bucket = stableHash(stickyValue) % 100;
  } else {
    bucket = Math.floor(random * 100);
  }

  return {
    version: bucket < canaryWeight ? "canary" : "baseline",
    canaryWeight,
    stageIndex: snapshot.stageIndex
  };
}
