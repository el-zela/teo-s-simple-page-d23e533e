import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthModal } from "@/components/auth-modal";
import { SYMBOLS, useLivePrices } from "@/hooks/use-live-prices";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { executeTrade } from "@/lib/trading.functions";
import { scoreTradeConfidence } from "@/lib/ai-confidence.functions";
import ForexChart from "@/components/ForexChart";
import { logAppError } from "@/lib/error-logger";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
  component: MarketsPage,
});

function MarketsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const prices = useLivePrices();
  const [selected, setSelected] = useState<string>(SYMBOLS[0].label);
  const [qty, setQty] = useState("0.01");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [confidence, setConfidence] = useState<null | { confidence: number; risk: string; rationale: string }>(null);
  const runTrade = useServerFn(executeTrade);
  const runScore = useServerFn(scoreTradeConfidence);
  const { openSignUp } = useAuthModal();

  const livePrice = prices[selected]?.price;

  async function placeOrder(side: "buy" | "sell") {
    if (!user) return toast.error(t("common.loginFirst"));
    if (!livePrice) return toast.error(t("common.waitingPrice"));
    const q = parseFloat(qty);
    if (!q || q <= 0) return toast.error(t("common.enterValidQty"));
    if (submitting) return;
    setSubmitting(true);
    const idem = `${user.id.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await runTrade({
        data: {
          symbol: selected as "EUR/USD" | "GBP/USD" | "USD/JPY" | "USD/CHF" | "AUD/USD",
          side, qty: q, idempotency_key: idem,
          client_price_hint: livePrice, max_slippage_pct: 1,
          stop_loss: stopLoss ? parseFloat(stopLoss) : undefined,
          take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
        },
      });
      if (!res.ok) {
        if (res.error === "slippage_exceeded") toast.error(t("markets.priceMoved", { price: res.live_price.toFixed(2) }));
        else if (res.error === "insufficient_funds") toast.error(t("common.insufficient"));
        else toast.error(res.error ?? t("common.failed"));
      } else {
        toast.success(`${res.side.toUpperCase()} ${res.qty} ${res.symbol} @ $${res.executed_price.toFixed(2)}`);
      }
    } catch (e: unknown) {
      logAppError(e, { component: "MarketsPage", action: "place-order", service: "executeTrade", metadata: { selected, side } });
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally { setSubmitting(false); }
  }

  async function runConfidence(side: "buy" | "sell") {
    if (!user) return toast.error(t("common.loginFirst"));
    if (!livePrice) return toast.error(t("common.waitingPrice"));
    const q = parseFloat(qty);
    if (!q || q <= 0) return toast.error(t("common.enterValidQty"));
    setScoring(true);
    try {
      const r = await runScore({
        data: {
          symbol: selected, side, qty: q, price: livePrice,
          stop_loss: stopLoss ? parseFloat(stopLoss) : undefined,
          take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
        },
      });
      if (r.ok) setConfidence({ confidence: r.confidence, risk: r.risk, rationale: r.rationale });
      else toast.error(r.error ?? t("markets.aiFailed"));
    } catch (e) {
      logAppError(e, { component: "MarketsPage", action: "score-confidence", service: "scoreTradeConfidence", metadata: { selected, side } });
      toast.error(t("markets.aiFailed"));
    } finally { setScoring(false); }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-28">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t("markets.kicker")}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-shimmer sm:text-4xl">{t("markets.title")}</h1>
        </div>
        {!user && (
          <button
            type="button"
            onClick={openSignUp}
            className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground glow"
          >
            {t("markets.openAccount")}
          </button>
        )}
      </header>

      <section className="mt-5">
        <ForexChart key={selected} symbol={selected} initialTimeframe="5m" height={380} />
      </section>

      <section className="card-premium card-premium-strong mt-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{t("markets.tradePanel")}</h2>
          <span className="font-mono text-sm text-shimmer">{livePrice ? `$${livePrice.toLocaleString()}` : "—"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-muted-foreground">
            {t("markets.symbol")}
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {SYMBOLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.label)}
                  className={`rounded-xl border px-2 py-2 text-xs font-semibold transition ${selected === s.label ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-input/30 text-muted-foreground hover:text-foreground"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("markets.qty")}
            <input type="number" min="0" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-input/40 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("markets.stopLoss")}
            <input type="number" min="0" step="0.01" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-input/40 px-3 py-2 text-sm" />
          </label>
          <label className="col-span-2 text-xs text-muted-foreground">
            {t("markets.takeProfit")}
            <input type="number" min="0" step="0.01" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-input/40 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button disabled={submitting} onClick={() => placeOrder("buy")} className="rounded-xl bg-[color:var(--success)] py-2.5 text-sm font-semibold text-black disabled:opacity-50">{t("markets.buy")}</button>
          <button disabled={submitting} onClick={() => placeOrder("sell")} className="rounded-xl bg-[color:var(--danger)] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{t("markets.sell")}</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button disabled={scoring} onClick={() => runConfidence("buy")} className="rounded-xl border border-border py-2 text-xs hover:bg-secondary/30 disabled:opacity-50">{t("markets.aiScoreBuy")}</button>
          <button disabled={scoring} onClick={() => runConfidence("sell")} className="rounded-xl border border-border py-2 text-xs hover:bg-secondary/30 disabled:opacity-50">{t("markets.aiScoreSell")}</button>
        </div>
        {confidence && (
          <div className="mt-3 rounded-xl border border-border bg-background/70 p-3 text-sm">
            <p><span className="text-muted-foreground">{t("markets.confidence")}</span> <b>{confidence.confidence.toFixed(0)}%</b> · <span className="text-muted-foreground">{t("markets.risk")}</span> <b className="capitalize">{confidence.risk}</b></p>
            <p className="mt-1 text-muted-foreground">{confidence.rationale}</p>
          </div>
        )}
      </section>
    </div>
  );
}
