import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  symbol: z.string().min(3).max(20),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  price: z.number().positive(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
});

const OutSchema = z.object({
  confidence: z.number().min(0).max(100),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(10).max(280),
});

export const scoreTradeConfidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false as const, error: "ai_unavailable" };
    try {
      const [{ generateText, Output }, { createLovableAiGatewayProvider }] = await Promise.all([
        import("ai"),
        import("@/lib/ai-gateway"),
      ]);
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway("google/gemini-2.5-flash-lite");
      const { experimental_output } = await generateText({
        model,
        experimental_output: Output.object({ schema: OutSchema }),
        prompt: `Score this proposed forex trade 0-100. Symbol=${data.symbol}, side=${data.side}, qty=${data.qty}, entry=${data.price}, stop=${data.stop_loss ?? "none"}, take_profit=${data.take_profit ?? "none"}. Consider risk/reward, distance to SL/TP in pips, and current forex session/regime. Reply with confidence, risk tier, and concise rationale (<240 chars).`,
      });
      return { ok: true as const, ...experimental_output };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "ai_error" };
    }
  });