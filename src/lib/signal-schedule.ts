import { FX_SYMBOLS } from "./forex-sim";

export const EAT_RELEASE_HOUR_UTC = 13; // 16:00 EAT is 13:00 UTC

export function getSignalCycleStart(now = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), EAT_RELEASE_HOUR_UTC, 0, 0, 0));
  if (now >= start) {
    return start;
  }
  const yesterday = new Date(start);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
}

export function getNextSignalCycleStart(now = new Date()): Date {
  const start = getSignalCycleStart(now);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function getSignalCycleIndex(now = new Date()): number {
  return Math.floor(getSignalCycleStart(now).getTime() / 86_400_000);
}

export function chooseDailySignalSymbol(now = new Date()): string {
  const index = getSignalCycleIndex(now) % FX_SYMBOLS.length;
  return FX_SYMBOLS[(index + FX_SYMBOLS.length) % FX_SYMBOLS.length];
}

export function getDailyReleaseLabel(now = new Date()): string {
  return getNextSignalCycleStart(now).toLocaleString("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    day: "numeric",
    month: "short",
  });
}
