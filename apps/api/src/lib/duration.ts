const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parses simple durations like "15m", "30d", "3600s" into seconds. */
export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) throw new Error(`Invalid duration string: ${input}`);
  const [, amount, unit] = match;
  return Number(amount) * UNIT_SECONDS[unit!]!;
}
