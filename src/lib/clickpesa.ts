// Pure helpers for ClickPesa integration (safe to import anywhere).

export const USD_TZS_RATE = 2650;
export const MIN_DEPOSIT_TZS = 132_500;

export type MobileChannel = "VODACOM" | "AIRTEL" | "TIGO" | "HALOTEL" | "TTCL" | "UNKNOWN";

/**
 * Normalize a Tanzanian phone number to the 12-digit `2557XXXXXXXX` form
 * expected by ClickPesa. Returns null if the input is not a valid TZ mobile.
 */
export function normalizeTzPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  let n = digits;
  if (n.startsWith("255")) n = n.slice(3);
  else if (n.startsWith("0")) n = n.slice(1);
  // Now n should be 9 digits starting with 6 or 7
  if (n.length !== 9) return null;
  if (!/^[67]\d{8}$/.test(n)) return null;
  return "255" + n;
}

export function detectChannel(normalizedPhone: string): MobileChannel {
  // normalizedPhone like 2557XXXXXXXX -> prefix = first 2 digits after 255
  const p = normalizedPhone.slice(3, 5);
  if (["74", "75", "76"].includes(p)) return "VODACOM";
  if (["78", "68", "69"].includes(p)) return "AIRTEL";
  if (["71", "65", "67"].includes(p)) return "TIGO";
  if (["62", "61"].includes(p)) return "HALOTEL";
  if (["73"].includes(p)) return "TTCL";
  return "UNKNOWN";
}

export function tzsToUsd(amountTzs: number): number {
  return Math.round((amountTzs / USD_TZS_RATE) * 100) / 100;
}
