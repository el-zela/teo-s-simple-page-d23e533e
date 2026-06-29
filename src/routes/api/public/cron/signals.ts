import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { FX_SYMBOLS, priceAt } from "@/lib/forex-sim";

const SignalSchema = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(10).max(400),
  target_price: z.number().positive(),
  stop_price: z.number().positive(),
  horizon_minutes: z.number().int().positive().max(1440),
});

export const Route = createFileRoute("/api/public/cron/signals")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("missing_key", { status: 500 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway("google/gemini-2.5-flash");
        const now = Math.floor(Date.now() / 1000);

        let inserted = 0;
        for (const label of FX_SYMBOLS) {
          const price = priceAt(label, now);
          const ref = priceAt(label, now - 86400);
          const change24h = ((price - ref) / ref) * 100;
          try {
            const { experimental_output } = await generateText({
              model,
              experimental_output: Output.object({ schema: SignalSchema }),
              prompt: `You are a forex quant trading model. Given ${label} price=${price.toFixed(5)}, 24h change=${change24h.toFixed(2)}%, produce a trading signal. Rationale <280 chars. target_price/stop_price within ~30-80 pips of entry.`,
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
        }

        return Response.json({ ok: true, inserted });
      },
    },
  },
});
