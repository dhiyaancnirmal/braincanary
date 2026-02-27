export class RunningStats {
  private n = 0;
  private mean = 0;
  private m2 = 0;
  private samples: number[] = [];

  static readonly MAX_SAMPLES = 10_000;

  add(value: number): void {
    this.n += 1;
    const delta = value - this.mean;
    this.mean += delta / this.n;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;

    if (this.samples.length < RunningStats.MAX_SAMPLES) {
      this.samples.push(value);
      return;
    }

    const index = Math.floor(Math.random() * this.n);
    if (index < RunningStats.MAX_SAMPLES) {
      this.samples[index] = value;
    }
  }

  merge(other: RunningStats): void {
    for (const value of other.rawSamples) {
      this.add(value);
    }
  }

  clone(): RunningStats {
    const copy = new RunningStats();
    copy.n = this.n;
    copy.mean = this.mean;
    copy.m2 = this.m2;
    copy.samples = [...this.samples];
    return copy;
  }

  reset(): void {
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
    this.samples = [];
  }

  get count(): number {
    return this.n;
  }

  get average(): number {
    return this.mean;
  }

  get variance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }

  get standardDeviation(): number {
    return Math.sqrt(this.variance);
  }

  get rawSamples(): number[] {
    return this.samples;
  }
}
