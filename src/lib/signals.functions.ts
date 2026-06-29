import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { FX_SYMBOLS, priceAt } from "@/lib/forex-sim";
import {
  chooseDailySignalSymbol,
  getNextSignalCycleStart,
  getSignalCycleStart,
} from "@/lib/signal-schedule";

const SignalSchema = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(10).max(300),
  target_price: z.number().positive(),
  stop_price: z.number().positive(),
  horizon_minutes: z.number().int().positive().max(1440),
});

type SignalPayload = z.infer<typeof SignalSchema>;

function buildFallbackSignal(symbol: string, now = Math.floor(Date.now() / 1000)): SignalPayload {
  const price = priceAt(symbol as typeof FX_SYMBOLS[number], now);
  const ref = priceAt(symbol as typeof FX_SYMBOLS[number], now - 86400);
  const change24h = ((price - ref) / ref) * 100;
  const isJpy = symbol.includes("JPY");
  const pip = isJpy ? 0.01 : 0.0001;
  const action = Math.abs(change24h) < 0.25 ? "hold" : change24h > 0 ? "buy" : "sell";
  const confidence = Math.min(98, Math.max(56, Math.round(60 + Math.abs(change24h) * 5)));
  const pips = Math.min(80, Math.max(30, Math.round(30 + Math.abs(change24h) * 20)));
  const target = action === "buy" ? price + pips * pip : action === "sell" ? price - pips * pip : price;
  const stop = action === "buy" ? price - Math.round(pips * 0.6) * pip : action === "sell" ? price + Math.round(pips * 0.6) * pip : price;
  return {
    action,
    confidence,
    rationale:
      action === "hold"
        ? `Market is range-bound on ${symbol}. Wait for a cleaner break before deploying capital.`
        : `Momentum leans ${action.toUpperCase()} after a ${change24h.toFixed(2)}% 24h move. TP is set about ${pips} pips, SL is disciplined.`,
    target_price: Number(target.toFixed(isJpy ? 2 : 5)),
    stop_price: Number(stop.toFixed(isJpy ? 2 : 5)),
    horizon_minutes: 360,
  };
}

async function fetchCurrentCycleSignal() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const cycleStart = getSignalCycleStart(now).toISOString();
  const nextCycleStart = getNextSignalCycleStart(now).toISOString();
  const { data, error } = await supabaseAdmin
    .from("signals")
    .select("*")
    .gte("created_at", cycleStart)
    .lt("created_at", nextCycleStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function createDailySignal(symbol: string) {
  const now = Math.floor(Date.now() / 1000);
  const apiKey = process.env.LOVABLE_API_KEY;
  let payload: SignalPayload;
  let model: string | null = null;

  if (apiKey) {
    try {
      const [{ generateText, Output }, { createLovableAiGatewayProvider }] = await Promise.all([
        import("ai"),
        import("@/lib/ai-gateway"),
      ]);
      const gateway = createLovableAiGatewayProvider(apiKey);
      const modelClient = gateway("google/gemini-2.5-flash");
      const price = priceAt(symbol as typeof FX_SYMBOLS[number], now);
      const ref = priceAt(symbol as typeof FX_SYMBOLS[number], now - 86400);
      const change24h = ((price - ref) / ref) * 100;
      const prompt = `You are a premium forex quant model. Given ${symbol} price=${price.toFixed(5)}, 24h change=${change24h.toFixed(2)}%, generate one high-conviction daily signal. Provide action, confidence, rationale, target_price, stop_price, and horizon_minutes. Set TP/SL roughly 30-80 pips from entry.`;
      const { experimental_output } = await generateText({
        model: modelClient,
        experimental_output: Output.object({ schema: SignalSchema }),
        prompt,
      });
      payload = experimental_output;
      model = "google/gemini-2.5-flash";
    } catch (error) {
      console.error("daily_signal_ai_failed", symbol, error);
      payload = buildFallbackSignal(symbol, now);
    }
  } else {
    payload = buildFallbackSignal(symbol, now);
  }

  const expiresAt = new Date(Date.now() + payload.horizon_minutes * 60_000).toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("signals")
    .insert({
      symbol,
      action: payload.action,
      confidence: payload.confidence,
      rationale: payload.rationale,
      target_price: payload.target_price,
      stop_price: payload.stop_price,
      horizon_minutes: payload.horizon_minutes,
      model,
      expires_at: expiresAt,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export const getDailySignalFeed = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const cycleStart = getSignalCycleStart(now);
  const nextCycleStart = getNextSignalCycleStart(now);
  const signal = await fetchCurrentCycleSignal();
  const previewSymbol = chooseDailySignalSymbol(now);
  const { data: history, error } = await supabaseAdmin
    .from("signals")
    .select("*")
    .lt("created_at", cycleStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    throw new Error(error.message);
  }
  return {
    signal,
    history: history ?? [],
    nextReleaseAt: nextCycleStart.toISOString(),
    cycleStart: cycleStart.toISOString(),
    previewSymbol,
    active: now >= cycleStart,
  };
});

export const ensureDailySignal = createServerFn({ method: "POST" }).handler(async () => {
  const now = new Date();
  const cycleStart = getSignalCycleStart(now);
  const nextCycleStart = getNextSignalCycleStart(now);
  const signal = await fetchCurrentCycleSignal();
  if (signal) {
    return { ok: true as const, signal, created: false, nextReleaseAt: nextCycleStart.toISOString() };
  }
  const symbol = chooseDailySignalSymbol(now);
  const createdSignal = await createDailySignal(symbol);
  return { ok: true as const, signal: createdSignal, created: true, nextReleaseAt: nextCycleStart.toISOString() };
});

/**
 * Generates fresh signals if none exist in the last 5 minutes.
 */
export const ensureLiveSignals = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: latest } = await supabaseAdmin
    .from("signals")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastTs = latest?.[0]?.created_at ? new Date(latest[0].created_at).getTime() : 0;
  const ageMs = Date.now() - lastTs;
  if (ageMs < 5 * 60_000) {
    return { ok: true as const, generated: 0, reason: "fresh" };
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false as const, error: "ai_unavailable" };

  const [{ generateText, Output }, { createLovableAiGatewayProvider }] = await Promise.all([
    import("ai"),
    import("@/lib/ai-gateway"),
  ]);
  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-2.5-flash");
  const now = Math.floor(Date.now() / 1000);

  let inserted = 0;
  await Promise.all(
    FX_SYMBOLS.map(async (label) => {
      const price = priceAt(label, now);
      const ref = priceAt(label, now - 86400);
      const change24h = ((price - ref) / ref) * 100;
      try {
        const { experimental_output } = await generateText({
          model,
          experimental_output: Output.object({ schema: SignalSchema }),
          prompt: `You are a forex quant model. ${label} price=${price.toFixed(5)}, 24h change=${change24h.toFixed(2)}%. Output a forex trading signal. Rationale <240 chars. target_price/stop_price within ~30-80 pips of entry.`,
        });
        const sig = experimental_output;
        await supabaseAdmin.from("signals").insert({
          symbol: label,
          action: sig.action,
          confidence: sig.confidence,
          rationale: sig.rationale,
          target_price: sig.target_price,
          stop_price: sig.stop_price,
          horizon_minutes: sig.horizon_minutes,
          model: "google/gemini-2.5-flash",
          expires_at: new Date(Date.now() + sig.horizon_minutes * 60_000).toISOString(),
        });
        inserted++;
      } catch (e) {
        console.error("signal_fail", label, e);
      }
    }),
  );

  return { ok: true as const, generated: inserted };
});
