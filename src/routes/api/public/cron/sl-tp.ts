import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { FX_SYMBOLS, priceAt, type FxSymbol } from "@/lib/forex-sim";

const SUPPORTED: ReadonlySet<string> = new Set(FX_SYMBOLS);

export const Route = createFileRoute("/api/public/cron/sl-tp")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: openTrades, error } = await supabaseAdmin
          .from("trades")
          .select("id, symbol, side, stop_loss, take_profit, price")
          .eq("status", "open")
          .or("stop_loss.not.is.null,take_profit.not.is.null")
          .limit(500);
        if (error) return new Response(error.message, { status: 500 });
        if (!openTrades || openTrades.length === 0) return Response.json({ ok: true, closed: 0 });

        const now = Math.floor(Date.now() / 1000);
        const priceFor = (sym: string): number | null =>
          SUPPORTED.has(sym) ? priceAt(sym as FxSymbol, now) : null;

        let closed = 0;
        for (const t of openTrades) {
          const p = priceFor(t.symbol);
          if (p == null) continue;
          const sl = t.stop_loss ? Number(t.stop_loss) : null;
          const tp = t.take_profit ? Number(t.take_profit) : null;
          let hit = false;
          if (t.side === "buy") {
            if (tp && p >= tp) hit = true;
            if (sl && p <= sl) hit = true;
          } else {
            if (tp && p <= tp) hit = true;
            if (sl && p >= sl) hit = true;
          }
          if (!hit) continue;
          const { error: rpcErr } = await supabaseAdmin.rpc("close_trade", {
            p_trade_id: t.id,
            p_close_price: p,
          });
          if (!rpcErr) closed++;
          else console.error("close_fail", t.id, rpcErr);
        }

        return Response.json({ ok: true, closed, scanned: openTrades.length });
      },
    },
  },
});
