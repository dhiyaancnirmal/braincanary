# 07 — Statistics Engine

## Why Welch's t-test

BrainCanary needs to answer: "Is the canary version worse than the baseline?" This is a classic two-sample comparison with potentially unequal variances and sample sizes (canary has fewer samples than baseline, especially in early stages).

**Welch's t-test** is the right choice because:
- Doesn't assume equal variances (Student's t-test does — wrong here since different prompts/models may have different score distributions)
- Handles unequal sample sizes (canary at 5% has far fewer samples)
- Well-understood, easy to implement, no library needed
- Used by every major A/B testing platform (Optimizely, Statsig, Eppo)

**Not using:**
- Mann-Whitney U: Non-parametric, more robust to non-normality, but harder to compute confidence intervals and overkill for this use case. Scores are typically 0-1 floats with reasonable distributions.
- Bayesian methods: More informative but harder to implement correctly, harder to explain, and the frequentist approach is standard in deployment tools.
- Bootstrap: Computationally expensive per evaluation cycle when we're polling every 30s.

## Implementation

```typescript
// packages/core/src/statistics/welch.ts

export interface TTestResult {
  t_statistic: number;
  degrees_of_freedom: number;
  p_value_two_sided: number;
  p_value_one_sided: number;  // P(canary < baseline)
  canary_mean: number;
  baseline_mean: number;
  canary_std: number;
  baseline_std: number;
  canary_n: number;
  baseline_n: number;
  mean_difference: number;
  confidence_interval_95: [number, number];  // of the difference
}

export function welchTTest(
  baseline: number[],
  canary: number[]
): TTestResult {
  const n1 = baseline.length;
  const n2 = canary.length;
  
  if (n1 < 2 || n2 < 2) {
    throw new Error("Need at least 2 samples per group");
  }
  
  // Means
  const mean1 = baseline.reduce((a, b) => a + b, 0) / n1;
  const mean2 = canary.reduce((a, b) => a + b, 0) / n2;
  
  // Variances (Bessel's correction)
  const var1 = baseline.reduce((sum, x) => sum + (x - mean1) ** 2, 0) / (n1 - 1);
  const var2 = canary.reduce((sum, x) => sum + (x - mean2) ** 2, 0) / (n2 - 1);
  
  // Welch's t-statistic
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    // Identical distributions — no difference
    return {
      t_statistic: 0,
      degrees_of_freedom: n1 + n2 - 2,
      p_value_two_sided: 1.0,
      p_value_one_sided: 0.5,
      canary_mean: mean2,
      baseline_mean: mean1,
      canary_std: Math.sqrt(var2),
      baseline_std: Math.sqrt(var1),
      canary_n: n2,
      baseline_n: n1,
      mean_difference: mean2 - mean1,
      confidence_interval_95: [0, 0],
    };
  }
  
  const t = (mean2 - mean1) / se;
  
  // Welch–Satterthwaite degrees of freedom
  const num = (var1 / n1 + var2 / n2) ** 2;
  const den =
    (var1 / n1) ** 2 / (n1 - 1) +
    (var2 / n2) ** 2 / (n2 - 1);
  const df = num / den;
  
  // p-value from t-distribution CDF
  const p_two_sided = 2 * tDistCDF(-Math.abs(t), df);
  
  // One-sided: probability canary is worse (mean2 < mean1)
  // If t < 0, canary mean is lower → p_one_sided is large
  const p_one_sided = tDistCDF(t, df);
  
  // 95% CI on the difference (mean2 - mean1)
  const t_critical = tDistQuantile(0.975, df);
  const ci_lower = (mean2 - mean1) - t_critical * se;
  const ci_upper = (mean2 - mean1) + t_critical * se;
  
  return {
    t_statistic: t,
    degrees_of_freedom: df,
    p_value_two_sided: p_two_sided,
    p_value_one_sided: p_one_sided,
    canary_mean: mean2,
    baseline_mean: mean1,
    canary_std: Math.sqrt(var2),
    baseline_std: Math.sqrt(var1),
    canary_n: n2,
    baseline_n: n1,
    mean_difference: mean2 - mean1,
    confidence_interval_95: [ci_lower, ci_upper],
  };
}
```

## t-Distribution CDF (Custom Implementation)

We implement the regularized incomplete beta function to compute the CDF. This avoids importing a statistics library for one function.

```typescript
// packages/core/src/statistics/distributions.ts

/**
 * Student's t-distribution CDF using the regularized incomplete beta function.
 * Accuracy: ~1e-10 for typical deployment scenarios.
 */
export function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - p : p;
}

/**
 * t-distribution quantile (inverse CDF) via bisection.
 * Used for confidence intervals.
 */
export function tDistQuantile(p: number, df: number): number {
  // Bisection search — sufficient precision for CI computation
  let lo = -10, hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tDistCDF(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Regularized incomplete beta function I_x(a, b)
 * Uses continued fraction expansion (Lentz's algorithm).
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;
  
  // Use symmetry relation when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }
  
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(
    Math.log(x) * a + Math.log(1 - x) * b - lnBeta
  ) / a;
  
  // Continued fraction (Lentz's method)
  let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;
  
  for (let m = 1; m <= 200; m++) {
    // Even step
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= c * d;
    
    // Odd step
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  
  return front * f;
}

/**
 * Log-gamma function (Lanczos approximation)
 */
function lnGamma(z: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  
  z -= 1;
  let x = coef[0];
  for (let i = 1; i < g + 2; i++) {
    x += coef[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
```

## Running Statistics (Incremental)

For efficiency, we maintain running statistics instead of storing all individual scores:

```typescript
// packages/core/src/statistics/running.ts

export class RunningStats {
  private n = 0;
  private mean = 0;
  private m2 = 0;        // sum of squared differences from mean
  private scores: number[] = [];  // keep raw scores for t-test (capped)
  
  private static MAX_SCORES = 10_000;  // cap memory usage
  
  add(value: number): void {
    this.n++;
    const delta = value - this.mean;
    this.mean += delta / this.n;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;
    
    if (this.scores.length < RunningStats.MAX_SCORES) {
      this.scores.push(value);
    } else {
      // Reservoir sampling for very high volume
      const j = Math.floor(Math.random() * this.n);
      if (j < RunningStats.MAX_SCORES) {
        this.scores[j] = value;
      }
    }
  }
  
  get count(): number { return this.n; }
  get average(): number { return this.mean; }
  get variance(): number { return this.n > 1 ? this.m2 / (this.n - 1) : 0; }
  get standardDeviation(): number { return Math.sqrt(this.variance); }
  get rawScores(): number[] { return this.scores; }
  
  reset(): void {
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
    this.scores = [];
  }
}
```

## Gate Evaluation Integration

```typescript
// packages/core/src/statistics/evaluate-gate.ts

export function evaluateGate(
  gate: Gate,
  baselineStats: RunningStats,
  canaryStats: RunningStats,
  minSamples: number
): GateResult {
  if (canaryStats.count < minSamples || baselineStats.count < 10) {
    return { status: "insufficient_data", ... };
  }
  
  // Absolute check
  const absolutePassing = canaryStats.average >= gate.threshold;
  
  // Statistical comparison
  let comparisonPassing = true;
  let pValue: number | null = null;
  
  if (gate.comparison !== "absolute_only") {
    const result = welchTTest(baselineStats.rawScores, canaryStats.rawScores);
    pValue = result.p_value_one_sided;
    
    if (gate.comparison === "not_worse_than_baseline") {
      // Fail only if we have strong evidence canary is worse
      // p_one_sided < alpha means canary is significantly worse
      comparisonPassing = pValue >= (1 - gate.confidence);
    } else if (gate.comparison === "better_than_baseline") {
      // Pass only if we have strong evidence canary is better
      comparisonPassing = (1 - pValue) >= gate.confidence;
    }
  }
  
  return {
    scorer: gate.scorer,
    status: absolutePassing && comparisonPassing ? "passing" : "failing",
    p_value: pValue,
    baseline_mean: baselineStats.average,
    canary_mean: canaryStats.average,
    absolute_check: absolutePassing,
    comparison_check: comparisonPassing,
    n_baseline: baselineStats.count,
    n_canary: canaryStats.count,
    confidence_required: gate.confidence,
  };
}
```

## Testing the Statistics

The statistics module should have the highest test coverage in the project. Test cases:

1. **Known distributions** — Generate samples from N(0.9, 0.05) and N(0.85, 0.05), verify t-test detects difference
2. **Same distribution** — Two samples from N(0.9, 0.05), verify no significant difference
3. **Small samples** — Verify behavior with n=5, n=10, n=30
4. **Edge cases** — Zero variance (all identical scores), single sample, empty arrays
5. **Comparison with scipy** — Pre-compute expected values using `scipy.stats.ttest_ind(equal_var=False)` and hardcode as test fixtures
