import { tDistCDF, tDistQuantile } from "./distributions.js";

export interface TTestResult {
  tStatistic: number;
  degreesOfFreedom: number;
  pValueTwoSided: number;
  pValueOneSided: number;
  baselineMean: number;
  canaryMean: number;
  baselineStd: number;
  canaryStd: number;
  baselineN: number;
  canaryN: number;
  meanDifference: number;
  confidenceInterval95: [number, number];
}

export function welchTTest(baseline: number[], canary: number[]): TTestResult {
  const n1 = baseline.length;
  const n2 = canary.length;
  if (n1 < 2 || n2 < 2) {
    throw new Error("Need at least 2 samples for each group");
  }

  const mean1 = baseline.reduce((sum, value) => sum + value, 0) / n1;
  const mean2 = canary.reduce((sum, value) => sum + value, 0) / n2;

  const var1 = baseline.reduce((sum, value) => sum + (value - mean1) ** 2, 0) / (n1 - 1);
  const var2 = canary.reduce((sum, value) => sum + (value - mean2) ** 2, 0) / (n2 - 1);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    return {
      tStatistic: 0,
      degreesOfFreedom: n1 + n2 - 2,
      pValueTwoSided: 1,
      pValueOneSided: 0.5,
      baselineMean: mean1,
      canaryMean: mean2,
      baselineStd: Math.sqrt(var1),
      canaryStd: Math.sqrt(var2),
      baselineN: n1,
      canaryN: n2,
      meanDifference: mean2 - mean1,
      confidenceInterval95: [0, 0]
    };
  }

  const tStatistic = (mean2 - mean1) / se;
  const numerator = (var1 / n1 + var2 / n2) ** 2;
  const denominator = (var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1);
  const degreesOfFreedom = numerator / denominator;

  const pValueTwoSided = 2 * tDistCDF(-Math.abs(tStatistic), degreesOfFreedom);
  const pValueOneSided = tDistCDF(tStatistic, degreesOfFreedom);

  const critical = tDistQuantile(0.975, degreesOfFreedom);
  const delta = critical * se;

  return {
    tStatistic,
    degreesOfFreedom,
    pValueTwoSided,
    pValueOneSided,
    baselineMean: mean1,
    canaryMean: mean2,
    baselineStd: Math.sqrt(var1),
    canaryStd: Math.sqrt(var2),
    baselineN: n1,
    canaryN: n2,
    meanDifference: mean2 - mean1,
    confidenceInterval95: [mean2 - mean1 - delta, mean2 - mean1 + delta]
  };
}
