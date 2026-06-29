// Live "prices" derived from the deterministic forex simulator.
// No external network. Updates on a 1s interval.

import { useEffect, useState } from "react";
import { FX_SYMBOLS, priceAt, type FxSymbol } from "@/lib/forex-sim";
import { logAppError } from "@/lib/error-logger";

export const SYMBOLS = FX_SYMBOLS.map((label) => ({
  id: label,
  label,
})) as ReadonlyArray<{ id: FxSymbol; label: FxSymbol }>;

export type PriceMap = Record<string, { price: number; change: number }>;

export function useLivePrices(): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const safeSnapshot = () => {
      try {
        setPrices(snapshot());
      } catch (error) {
        logAppError(error, { component: "useLivePrices", action: "snapshot", service: "forex-sim" });
      }
    };
    safeSnapshot();
    const i = setInterval(safeSnapshot, 1000);
    return () => clearInterval(i);
  }, []);

  return prices;
}

function snapshot(): PriceMap {
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;
  const out: PriceMap = {};
  for (const s of FX_SYMBOLS) {
    const p = priceAt(s, now);
    const ref = priceAt(s, dayAgo);
    out[s] = { price: p, change: ((p - ref) / ref) * 100 };
  }
  return out;
}
