import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FX_SYMBOLS, priceAt, type FxSymbol } from "@/lib/forex-sim";

const ExecuteTradeInput = z.object({
  symbol: z.enum(FX_SYMBOLS as unknown as [FxSymbol, ...FxSymbol[]]),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive().max(1_000_000),
  idempotency_key: z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
  client_price_hint: z.number().positive().optional(),
  max_slippage_pct: z.number().min(0).max(10).default(1),
});

function getSimPrice(symbol: FxSymbol): number {
  return priceAt(symbol, Math.floor(Date.now() / 1000));
}

export const executeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ExecuteTradeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const livePrice = getSimPrice(data.symbol);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.client_price_hint) {
      const diffPct = (Math.abs(livePrice - data.client_price_hint) / data.client_price_hint) * 100;
      if (diffPct > data.max_slippage_pct) {
        return { ok: false as const, error: "slippage_exceeded", live_price: livePrice };
      }
    }

    const { data: tradeId, error } = await supabaseAdmin.rpc("execute_trade", {
      p_user_id: userId,
      p_symbol: data.symbol,
      p_side: data.side,
      p_qty: data.qty,
      p_price: livePrice,
      p_idempotency_key: data.idempotency_key,
      p_stop_loss: data.stop_loss,
      p_take_profit: data.take_profit,
    });

    if (error) {
      return { ok: false as const, error: error.message, live_price: livePrice };
    }

    return {
      ok: true as const,
      trade_id: tradeId as string,
      executed_price: livePrice,
      qty: data.qty,
      side: data.side,
      symbol: data.symbol,
    };
  });
