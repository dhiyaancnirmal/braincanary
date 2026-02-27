import type { Gate } from "../config/schema.js";
import { welchTTest } from "./welch.js";

export interface StatsLike {
  readonly count: number;
  readonly average: number;
  readonly rawSamples: number[];
}

export interface GateResult {
  scorer: string;
  status: "passing" | "failing" | "insufficient_data";
  pValue: number | null;
  baselineMean: number;
  canaryMean: number;
  baselineN: number;
  canaryN: number;
  absoluteCheck: boolean;
  comparisonCheck: boolean;
  confidenceRequired: number;
}

export function evaluateGate(
  gate: Gate,
  baselineStats: StatsLike,
  canaryStats: StatsLike,
  minSamples: number
): GateResult {
  const baselineMean = baselineStats.average;
  const canaryMean = canaryStats.average;
  const baselineN = baselineStats.count;
  const canaryN = canaryStats.count;

  if (canaryN < minSamples || baselineN < 10) {
    return {
      scorer: gate.scorer,
      status: "insufficient_data",
      pValue: null,
      baselineMean,
      canaryMean,
      baselineN,
      canaryN,
      absoluteCheck: false,
      comparisonCheck: false,
      confidenceRequired: gate.confidence
    };
  }

  const absoluteCheck = canaryMean >= gate.threshold;
  let comparisonCheck = true;
  let pValue: number | null = null;

  if (gate.comparison !== "absolute_only") {
    const result = welchTTest(baselineStats.rawSamples, canaryStats.rawSamples);
    pValue = result.pValueOneSided;

    if (gate.comparison === "not_worse_than_baseline") {
      comparisonCheck = pValue >= 1 - gate.confidence;
    } else {
      comparisonCheck = 1 - pValue >= gate.confidence;
    }
  }

  return {
    scorer: gate.scorer,
    status: absoluteCheck && comparisonCheck ? "passing" : "failing",
    pValue,
    baselineMean,
    canaryMean,
    baselineN,
    canaryN,
    absoluteCheck,
    comparisonCheck,
    confidenceRequired: gate.confidence
  };
}
