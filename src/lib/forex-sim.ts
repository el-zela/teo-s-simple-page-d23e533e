// Forex simulation engine.
// - Deterministic: priceAt(symbol, t) is a pure function of (symbol, t).
//   Therefore historical candles NEVER change.
// - Real-clock aligned: bar boundaries are wall-clock multiples of tfSec.
// - Session-aware volatility (Asian / London / NY).
// - Pure JS, safe for both browser and Cloudflare Worker (server functions).

export const FX_SYMBOLS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
] as const;
export type FxSymbol = (typeof FX_SYMBOLS)[number];

export const FX_SYMBOL_META: Record<FxSymbol, { base: number; pip: number; decimals: number }> = {
  "EUR/USD": { base: 1.0850, pip: 0.0001, decimals: 5 },
  "GBP/USD": { base: 1.2700, pip: 0.0001, decimals: 5 },
  "USD/JPY": { base: 156.50, pip: 0.01,   decimals: 3 },
  "USD/CHF": { base: 0.9050, pip: 0.0001, decimals: 5 },
  "AUD/USD": { base: 0.6600, pip: 0.0001, decimals: 5 },
};

export type Timeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400,
};

export type Candle = {
  time: number; // unix seconds (UTC)
  open: number; high: number; low: number; close: number; volume: number;
};

// ---------- Deterministic hashing & noise ----------

function h32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function frac(x: number): number { return x - Math.floor(x); }

// Deterministic [0,1) noise from (symbol, bucket, salt)
function rand01(symbol: string, bucket: number, salt: string): number {
  const h = h32(`${symbol}|${salt}|${bucket}`);
  return frac(Math.sin(h * 0.0001) * 43758.5453);
}

// Smooth signed noise [-1, 1] interpolated between integer buckets.
function smoothNoise(symbol: string, t: number, period: number, salt: string): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const a = rand01(symbol, i, salt) * 2 - 1;
  const b = rand01(symbol, i + 1, salt) * 2 - 1;
  // smoothstep
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

// ---------- Sessions ----------

export type Session = "asia" | "london" | "ny" | "off";

export function sessionAt(tsSec: number): Session {
  const h = new Date(tsSec * 1000).getUTCHours();
  // Asia 00-07, London 07-12, Overlap 12-16 (NY+London), NY 16-21, Off 21-24
  if (h >= 12 && h < 16) return "ny";       // overlap treated as NY (highest)
  if (h >= 7  && h < 12) return "london";
  if (h >= 16 && h < 21) return "ny";
  if (h >= 0  && h < 7 ) return "asia";
  return "off";
}

function sessionVol(tsSec: number): number {
  switch (sessionAt(tsSec)) {
    case "ny":     return 1.35; // includes London/NY overlap
    case "london": return 1.15;
    case "asia":   return 0.55;
    case "off":    return 0.35;
  }
}

// ---------- Continuous price model ----------

/**
 * priceAt: continuous, deterministic mid-price for symbol at unix-seconds ts.
 * Combines multi-scale sinusoids + smooth seeded regime drift. No randomness.
 */
export function priceAt(symbol: FxSymbol, tsSec: number): number {
  const meta = FX_SYMBOL_META[symbol];
  const seed = h32(symbol);
  const ph = (k: number) => (((seed >>> k) & 0xffff) / 0xffff) * Math.PI * 2;

  const min = tsSec / 60;
  const trend30d = Math.sin(min / (60 * 24 * 30) * 2 * Math.PI + ph(0))  * 0.040;
  const trend7d  = Math.sin(min / (60 * 24 * 7)  * 2 * Math.PI + ph(3))  * 0.022;
  const day      = Math.sin(min / (60 * 24)       * 2 * Math.PI + ph(7))  * 0.012;
  const h4       = Math.sin(min / (60 * 4)        * 2 * Math.PI + ph(11)) * 0.0045;
  const h1       = Math.sin(min / 60              * 2 * Math.PI + ph(15)) * 0.0022;
  const m15      = Math.sin(min / 15              * 2 * Math.PI + ph(19)) * 0.0010;

  // Smooth regime walks at multiple scales — gives trends/pullbacks/consolidations.
  const regimeSlow = smoothNoise(symbol, tsSec, 4 * 3600, "regS") * 0.012;   // 4h
  const regimeMid  = smoothNoise(symbol, tsSec,    3600, "regM") * 0.005;    // 1h
  const regimeFast = smoothNoise(symbol, tsSec,     300, "regF") * 0.0018;   // 5m

  // Liquidity sweep: brief sharp wick approx every ~6h, seeded per 30m bucket
  const sweepBucket = Math.floor(tsSec / 1800);
  const sweepGate   = rand01(symbol, sweepBucket, "swG");
  const sweep = sweepGate > 0.92
    ? (rand01(symbol, sweepBucket, "swD") - 0.5) * 0.004
    : 0;

  const factor = 1 + trend30d + trend7d + day + h4 + h1 + m15
                 + regimeSlow + regimeMid + regimeFast + sweep;
  return meta.base * factor;
}

// ---------- Candle construction ----------

export function alignBar(tsSec: number, tfSec: number): number {
  return Math.floor(tsSec / tfSec) * tfSec;
}

/**
 * Build a candle for [barStart, barStart+tfSec). If `truncateTo` is provided,
 * the candle is built only up to that time (used for the live partial bar).
 * Deterministic: same args → same OHLC.
 */
export function buildCandle(
  symbol: FxSymbol,
  tfSec: number,
  barStart: number,
  truncateTo?: number,
): Candle {
  const meta = FX_SYMBOL_META[symbol];
  const end = Math.min(truncateTo ?? barStart + tfSec, barStart + tfSec);
  const span = Math.max(1, end - barStart);

  // Sample density: more points for higher TFs so wicks look real.
  const samples = Math.min(48, Math.max(6, Math.floor(tfSec / Math.max(60, tfSec / 24))));
  const open = priceAt(symbol, barStart);
  let high = open, low = open, last = open;

  const vol = sessionVol(barStart + span / 2);

  for (let i = 1; i <= samples; i++) {
    const t = barStart + (span * i) / samples;
    // micro noise per sub-sample, scaled by session and pip size
    const microSeed = Math.floor(t / Math.max(1, span / samples));
    const micro = (rand01(symbol, microSeed, "uS") - 0.5) * meta.pip * 8 * vol;
    const p = priceAt(symbol, t) + micro;
    if (p > high) high = p;
    if (p < low)  low  = p;
    last = p;
  }
  const close = last;

  // Occasional volatility spike (seeded per bar)
  if (rand01(symbol, barStart, "spk") > 0.97) {
    const dir = rand01(symbol, barStart, "spkD") > 0.5 ? 1 : -1;
    const amp = meta.pip * 18 * vol;
    if (dir > 0) high = Math.max(high, Math.max(open, close) + amp);
    else         low  = Math.min(low,  Math.min(open, close) - amp);
  }

  const range = Math.max(meta.pip, high - low);
  const volume = Math.max(40, 600 * vol * (1 + (range / meta.pip) * 0.6));

  return { time: barStart, open, high, low, close, volume };
}

/**
 * Build a list of `count` closed candles strictly BEFORE the current live bar,
 * ending at `endBarStart - tfSec`.
 */
export function buildHistory(
  symbol: FxSymbol,
  tfSec: number,
  endBarStartExclusive: number,
  count: number,
): Candle[] {
  const out: Candle[] = new Array(count);
  let t = endBarStartExclusive - count * tfSec;
  for (let i = 0; i < count; i++) {
    out[i] = buildCandle(symbol, tfSec, t);
    t += tfSec;
  }
  return out;
}

// ---------- Indicators (pure utilities) ----------

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      if (i === period - 1) {
        let s = 0; for (let j = 0; j <= i; j++) s += values[j];
        prev = s / period; out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k); out[i] = prev;
    }
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= period) {
      gain += g; loss += l;
      if (i === period) {
        gain /= period; loss /= period;
        const rs = loss === 0 ? 100 : gain / loss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      const rs = loss === 0 ? 100 : gain / loss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const filled: number[] = []; const idxMap: number[] = [];
  macdLine.forEach((v, i) => { if (v != null) { filled.push(v); idxMap.push(i); } });
  const signalRaw = ema(filled, signal);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  signalRaw.forEach((v, k) => { if (v != null) signalLine[idxMap[k]] = v; });
  const hist: (number | null)[] = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? (macdLine[i] as number) - (signalLine[i] as number) : null,
  );
  return { macdLine, signalLine, hist };
}
