import { describe, expect, it } from "vitest";
import { welchTTest } from "./welch.js";

describe("welchTTest", () => {
  it("detects lower canary mean", () => {
    const baseline = [0.9, 0.92, 0.88, 0.91, 0.9, 0.89, 0.93, 0.9, 0.91, 0.92];
    const canary = [0.78, 0.75, 0.8, 0.76, 0.79, 0.77, 0.75, 0.78, 0.76, 0.77];

    const result = welchTTest(baseline, canary);
    expect(result.meanDifference).toBeLessThan(0);
    expect(result.pValueOneSided).toBeLessThan(0.01);
  });

  it("returns weak signal on similar distributions", () => {
    const baseline = [0.9, 0.91, 0.89, 0.9, 0.91, 0.88, 0.9, 0.9, 0.91, 0.89];
    const canary = [0.9, 0.89, 0.9, 0.9, 0.88, 0.91, 0.9, 0.89, 0.91, 0.9];

    const result = welchTTest(baseline, canary);
    expect(result.pValueTwoSided).toBeGreaterThan(0.05);
  });
});
