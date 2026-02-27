const EPSILON = 1e-30;

export function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - p : p;
}

export function tDistQuantile(p: number, df: number): number {
  let lo = -50;
  let hi = 50;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (tDistCDF(mid, df) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < EPSILON) d = EPSILON;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 250; m++) {
    let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < EPSILON) d = EPSILON;
    c = 1 + numerator / c;
    if (Math.abs(c) < EPSILON) c = EPSILON;
    d = 1 / d;
    f *= c * d;

    numerator = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < EPSILON) d = EPSILON;
    c = 1 + numerator / c;
    if (Math.abs(c) < EPSILON) c = EPSILON;
    d = 1 / d;

    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-11) {
      break;
    }
  }

  return front * f;
}

function lnGamma(z: number): number {
  const coeffs = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }

  z -= 1;
  let x = coeffs[0]!;
  for (let i = 1; i < coeffs.length; i++) {
    x += coeffs[i]! / (z + i);
  }
  const t = z + coeffs.length - 1.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
