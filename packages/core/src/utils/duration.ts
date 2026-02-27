const DURATION_RE = /^(\d+)(ms|s|m|h)$/;

export type DurationUnit = "ms" | "s" | "m" | "h";

const MULTIPLIER: Record<DurationUnit, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000
};

export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${input}. Use formats like 30s, 10m, 1h.`);
  }
  const value = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return value * MULTIPLIER[unit];
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1_000)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m`;
  }
  return `${Math.round(ms / 3_600_000)}h`;
}
