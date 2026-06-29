import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { useServerFn } from "@tanstack/react-start";
import { ensureDailySignal, getDailySignalFeed } from "@/lib/signals.functions";
import { getRedemptionStatus, redeemSignal } from "@/lib/redemptions.functions";
import { toast } from "sonner";
import { Lock, Sparkles } from "lucide-react";
import { logAppError } from "@/lib/error-logger";
import { FX_SYMBOL_META, priceAt, type FxSymbol } from "@/lib/forex-sim";
import { chooseDailySignalSymbol } from "@/lib/signal-schedule";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/signals")({
  component: SignalsPage,
});

type Signal = {
  id: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  rationale: string | null;
  target_price: number | null;
  stop_price: number | null;
  horizon_minutes: number | null;
  expires_at: string | null;
  created_at: string;
};

const ALLOWED = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD"] as const;

function buildFallbackSignal(symbol: string): Signal {
  const sym = (ALLOWED.includes(symbol as typeof ALLOWED[number]) ? symbol : "EUR/USD") as FxSymbol;
  const now = Math.floor(Date.now() / 1000);
  const price = priceAt(sym, now);
  const ref = priceAt(sym, now - 86400);
  const change = ((price - ref) / ref) * 100;
  const action: Signal["action"] = Math.abs(change) < 0.2 ? "hold" : change > 0 ? "buy" : "sell";
  const meta = FX_SYMBOL_META[sym];
  const pips = 50;
  const tp = action === "buy" ? price + pips * meta.pip : action === "sell" ? price - pips * meta.pip : price;
  const sl = action === "buy" ? price - pips * 0.6 * meta.pip : action === "sell" ? price + pips * 0.6 * meta.pip : price;
  return {
    id: `fallback-${sym}-${Math.floor(now / 86400)}`,
    symbol: sym,
    action,
    confidence: 68,
    rationale: action === "hold"
      ? `Market on ${sym} is consolidating. Wait for breakout.`
      : `Momentum favours ${action.toUpperCase()} after ${change.toFixed(2)}% 24h move.`,
    target_price: Number(tp.toFixed(meta.decimals)),
    stop_price: Number(sl.toFixed(meta.decimals)),
    horizon_minutes: 360,
    expires_at: new Date(Date.now() + 360 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };
}

function useCountdown(target: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!target || target <= Date.now()) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [target]);
  const ms = now ? Math.max(0, target - now) : 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return { ms, label: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` };
}

function SignalsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [redeemedIds, setRedeemedIds] = useState<Set<string>>(new Set());
  const [nextAvailableAt, setNextAvailableAt] = useState(0);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const ensureSignals = useServerFn(ensureDailySignal);
  const getDailyFeed = useServerFn(getDailySignalFeed);
  const getStatus = useServerFn(getRedemptionStatus);
  const runRedeem = useServerFn(redeemSignal);

  const cd = useCountdown(nextAvailableAt);
  const canRedeem = useMemo(() => !nextAvailableAt || cd.ms === 0, [nextAvailableAt, cd.ms]);

  const load = useCallback(async () => {
    try {
      const feed = await getDailyFeed();
      const sig = (feed.signal ?? null) as Signal | null;
      setSignal(sig ?? buildFallbackSignal(feed.previewSymbol ?? chooseDailySignalSymbol()));
      setLoadError(null);
    } catch (error) {
      logAppError(error, { component: "SignalsPage", action: "load", service: "signals" });
      setSignal(buildFallbackSignal(chooseDailySignalSymbol()));
      setLoadError(t("signals.delayedNotice"));
    } finally {
      setLoading(false);
    }
  }, [getDailyFeed, t]);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const r = await getStatus();
      setRedeemedIds(new Set(r.redeemedIds));
      setNextAvailableAt(r.nextAvailableAt);
    } catch { /* ignore */ }
  }, [user, getStatus]);

  useEffect(() => {
    load();
    ensureSignals().then(() => load()).catch(() => undefined);
  }, [load, ensureSignals]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function handleRedeem(signal: Signal) {
    if (!user) return toast.error(t("common.loginFirst"));
    if (redeemedIds.has(signal.id)) return;
    if (!canRedeem) return toast.error(t("signals.waitForNext", { label: cd.label }));
    setRedeemingId(signal.id);
    try {
      const r = await runRedeem({ data: { signal_id: signal.id } });
      if (!r.ok) {
        if (r.error === "cooldown" && r.nextAvailableAt) {
          setNextAvailableAt(r.nextAvailableAt);
          toast.error(t("signals.oneFreePer24"));
        } else toast.error(r.error ?? t("common.failed"));
      } else {
        setRedeemedIds((prev) => new Set(prev).add(signal.id));
        if (!r.alreadyRedeemed) {
          setNextAvailableAt(Date.now() + 24 * 60 * 60 * 1000);
          toast.success(t("signals.unlocked"));
        }
      }
    } catch (error) {
      logAppError(error, { component: "SignalsPage", action: "redeem", service: "redeemSignal", metadata: { signalId: signal.id } });
      toast.error(t("signals.redeemFailed"));
    } finally { setRedeemingId(null); }
  }

  const unlocked = signal ? (!user || redeemedIds.has(signal.id)) : false;

  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-28">
      <div>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">{t("signals.kicker")}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-shimmer">{t("signals.title")}</h1>
      </div>

      {!user ? (
        <div className="mt-6"><AuthGate title={t("signals.gateTitle")} message={t("signals.gateMessage")} /></div>
      ) : (
      <div className="mt-5">

        {loading && !signal && <div className="card-premium h-48 animate-pulse" />}
        {loadError && !loading && (
          <div className="card-premium mb-3 p-3 text-xs text-muted-foreground">{loadError}</div>
        )}
        {signal && (
          <div className="card-premium card-premium-strong p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("signals.title")}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{signal.symbol}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                  signal.action === "buy"
                    ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                    : signal.action === "sell"
                    ? "bg-[color:var(--danger)]/15 text-[color:var(--danger)]"
                    : "bg-muted/20 text-muted-foreground"
                }`}
              >
                {signal.action} · {signal.confidence.toFixed(0)}%
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="card-premium p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">TP</p>
                <p className={`mt-1 font-mono text-sm font-semibold ${unlocked ? "text-shimmer" : "blur-sm select-none"}`}>
                  {signal.target_price?.toFixed(4) ?? "—"}
                </p>
              </div>
              <div className="card-premium p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">SL</p>
                <p className={`mt-1 font-mono text-sm font-semibold ${unlocked ? "text-shimmer" : "blur-sm select-none"}`}>
                  {signal.stop_price?.toFixed(4) ?? "—"}
                </p>
              </div>
            </div>

            <div className="mt-3 card-premium p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t("signals.aiRationale")}</p>
              <p className={`text-xs leading-relaxed ${unlocked ? "text-foreground/90" : "blur-sm select-none text-muted-foreground"}`}>
                {unlocked ? (signal.rationale ?? "—") : t("signals.lockedRationale")}
              </p>
            </div>

            {user && !unlocked && (
              <button
                disabled={!canRedeem || redeemingId === signal.id}
                onClick={() => handleRedeem(signal)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--success)]/40 bg-[color:var(--success)]/10 px-4 py-3 text-sm font-bold uppercase text-[color:var(--success)] disabled:opacity-50"
              >
                {redeemingId === signal.id ? "…" : canRedeem ? (
                  <><Sparkles className="h-4 w-4" /> {t("signals.redeemFree")}</>
                ) : (
                  <><Lock className="h-4 w-4" /> {cd.label}</>
                )}
              </button>
            )}

            {user && unlocked && (
              <div className="mt-4 rounded-xl border border-[color:var(--success)]/30 bg-[color:var(--success)]/10 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-[color:var(--success)]">
                ✓ {t("signals.unlocked")}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>

  );
}
