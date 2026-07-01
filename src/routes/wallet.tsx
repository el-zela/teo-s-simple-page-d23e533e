import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ArrowDownRight, ArrowUpRight, X, Loader2 } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { useServerFn } from "@tanstack/react-start";
import { withdrawFunds } from "@/lib/wallet.functions";
import { initiateDeposit, checkDepositStatus } from "@/lib/clickpesa.functions";
import { detectChannel, normalizeTzPhone, tzsToUsd, USD_TZS_RATE, MIN_DEPOSIT_TZS } from "@/lib/clickpesa";
import { toast } from "sonner";
import { logAppError } from "@/lib/error-logger";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

type Wallet = { id: string; type: string; balance: number; currency: string };
type Trade = { id: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; status: string; created_at: string };
type Deposit = {
  id: string;
  order_reference: string;
  amount_tzs: number;
  amount_usd: number;
  channel: string | null;
  status: string;
  created_at: string;
};

function WalletPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [modal, setModal] = useState<null | "deposit" | "withdraw">(null);
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Deposit fields
  const [payerName, setPayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [tzsAmount, setTzsAmount] = useState("");
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string>("");

  // Withdraw field
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const runWithdraw = useServerFn(withdrawFunds);
  const runDeposit = useServerFn(initiateDeposit);
  const runCheckStatus = useServerFn(checkDepositStatus);

  async function refreshAll() {
    if (!user) return;
    try {
      const [w, d] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user.id).eq("type", "main"),
        supabase.from("deposits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      ]);
      if (w.error) throw w.error;
      if (d.error) throw d.error;
      setWallets((w.data ?? []) as Wallet[]);
      setDeposits((d.data ?? []) as Deposit[]);
      setDataError(null);
    } catch (error) {
      logAppError(error, { component: "WalletPage", action: "refresh", service: "wallets" });
      setDataError("Wallet data delayed.");
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setDataLoading(true);
    Promise.all([
      refreshAll(),
      supabase.from("trades").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)
        .then(({ data, error }) => {
          if (error) throw error;
          if (!cancelled) setTrades((data ?? []) as Trade[]);
        }),
    ]).catch((error) => {
      logAppError(error, { component: "WalletPage", action: "load", service: "wallet/trades" });
      if (!cancelled) setDataError("Wallet data delayed.");
    }).finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Poll deposit status while pending
  useEffect(() => {
    if (!pendingRef) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await runCheckStatus({ data: { order_reference: pendingRef } });
        if (stop) return;
        if (res.ok) {
          setPendingStatus(res.status);
          if (res.credited_at || res.status === "SUCCESS") {
            toast.success(`Umepokea $${Number(res.amount_usd).toFixed(2)} kwenye wallet yako`);
            setPendingRef(null);
            setPendingStatus("");
            setModal(null);
            await refreshAll();
            return;
          }
          if (["FAILED", "CANCELLED", "REJECTED", "EXPIRED"].includes(res.status?.toUpperCase?.() ?? "")) {
            toast.error(`Malipo hayakukamilika: ${res.status}`);
            setPendingRef(null);
            setPendingStatus("");
            await refreshAll();
            return;
          }
        }
      } catch {/* ignore */}
    };
    const id = window.setInterval(tick, 4000);
    tick();
    return () => { stop = true; window.clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRef]);

  const mainBalance = wallets.find((w) => w.type === "main")?.balance ?? 0;
  const normalizedPhonePreview = normalizeTzPhone(phone);
  const detectedChannel = normalizedPhonePreview ? detectChannel(normalizedPhonePreview) : null;
  const tzsNum = parseInt(tzsAmount || "0", 10) || 0;
  const usdPreview = tzsNum > 0 ? tzsToUsd(tzsNum) : tzsToUsd(MIN_DEPOSIT_TZS);

  async function submitDeposit() {
    if (busy) return;
    const tzs = parseInt(tzsAmount || "0", 10);
    if (!payerName.trim() || payerName.trim().length < 2) return toast.error(t("wallet.invalidName"));
    if (!normalizedPhonePreview) return toast.error(t("wallet.invalidPhone"));
    if (detectedChannel === "UNKNOWN") return toast.error(t("wallet.unknownNetwork"));
    if (!tzs || tzs < MIN_DEPOSIT_TZS) {
      return toast.error(t("wallet.minAmount", { amt: MIN_DEPOSIT_TZS.toLocaleString() }));
    }
    setBusy(true);
    try {
      const res = await runDeposit({ data: { payer_name: payerName.trim(), phone_number: phone, amount_tzs: tzs } });
      if (!res.ok) {
        const map: Record<string, string> = {
          invalid_phone: t("wallet.invalidPhone"),
          unsupported_network: t("wallet.unknownNetwork"),
          [`min_amount_${MIN_DEPOSIT_TZS}`]: t("wallet.minAmount", { amt: MIN_DEPOSIT_TZS.toLocaleString() }),
        };
        toast.error(map[res.error] ?? res.error);
      } else {
        toast.success(t("wallet.requestSent", { channel: res.channel }));
        setPendingRef(res.order_reference);
        setPendingStatus("PROCESSING");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdraw() {
    if (busy) return;
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) return toast.error(t("common.enterValidAmount"));
    setBusy(true);
    const idem = `withdraw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await runWithdraw({ data: { wallet_type: "main", amount: amt, idempotency_key: idem } });
      if (!res.ok) {
        toast.error(res.error === "insufficient_funds" ? t("common.insufficient") : res.error);
      } else {
        toast.success(t("wallet.withdrewToast", { amt: amt.toFixed(2) }));
        setWithdrawAmount("");
        setModal(null);
        await refreshAll();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    if (busy) return;
    setModal(null);
    setPayerName("");
    setPhone("");
    setTzsAmount("");
    setWithdrawAmount("");
    setPendingRef(null);
    setPendingStatus("");
  }

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-muted-foreground">{t("common.loading")}</div>;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("wallet.title")}</h1>
        <div className="mt-4"><AuthGate title={t("wallet.gateTitle")} message={t("wallet.gateMessage")} /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-5 pb-28">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("wallet.title")}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setModal("deposit")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[color:var(--success)] px-3 py-2 text-xs font-bold text-black"
          >
            <ArrowDownRight className="h-4 w-4" /> {t("wallet.deposit")}
          </button>
          <button
            onClick={() => setModal("withdraw")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[color:var(--danger)] px-3 py-2 text-xs font-bold text-white"
          >
            <ArrowUpRight className="h-4 w-4" /> {t("wallet.withdraw")}
          </button>
        </div>
      </div>

      {/* Main balance card */}
      <div className="card-premium mt-5 p-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Main Balance</p>
        <p className="mt-3 font-mono text-4xl font-bold tracking-tight text-shimmer">
          ${mainBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">USD · 1 USD = {USD_TZS_RATE.toLocaleString()} TZS</p>
      </div>

      {dataLoading && <div className="mt-4 card-premium h-20 animate-pulse" />}
      {dataError && <div className="mt-4 card-premium p-3 text-sm text-muted-foreground">{dataError}</div>}

      {/* Deposit modal */}
      {modal === "deposit" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={closeModal}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Deposit (ClickPesa)</h3>
              <button onClick={closeModal} className="rounded-full p-1 hover:bg-secondary/40"><X className="h-4 w-4" /></button>
            </div>

            {pendingRef ? (
              <div className="mt-6 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-[color:var(--success)]" />
                <p className="mt-4 text-sm font-medium">Angalia simu yako kwa pop-up ya malipo</p>
                <p className="mt-1 text-xs text-muted-foreground">Status: {pendingStatus || "PROCESSING"}</p>
                <p className="mt-3 text-[11px] text-muted-foreground">Ref: {pendingRef}</p>
                <button
                  onClick={() => { setPendingRef(null); setPendingStatus(""); }}
                  className="mt-5 w-full rounded-2xl border border-border py-2.5 text-xs font-semibold text-muted-foreground"
                >
                  Funga
                </button>
              </div>
            ) : (
              <>
                <label className="mt-4 block text-xs text-muted-foreground">Jina kamili</label>
                <input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="John Doe"
                  className="mt-1 w-full rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm"
                />

                <label className="mt-3 block text-xs text-muted-foreground">Namba ya simu (TZ)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0712345678"
                  className="mt-1 w-full rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm"
                />
                {phone && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {detectedChannel && detectedChannel !== "UNKNOWN"
                      ? `Mtandao: ${detectedChannel}`
                      : "Namba si sahihi"}
                  </p>
                )}

                <label className="mt-3 block text-xs text-muted-foreground">Kiasi (TZS)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_DEPOSIT_TZS}
                  step="500"
                  value={tzsAmount}
                  onChange={(e) => setTzsAmount(e.target.value)}
                  placeholder={String(MIN_DEPOSIT_TZS)}
                  className="mt-1 w-full rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Min: TZS {MIN_DEPOSIT_TZS.toLocaleString()} · Utapokea: ${usdPreview.toFixed(2)}
                </p>

                <button
                  disabled={busy}
                  onClick={submitDeposit}
                  className="mt-5 w-full rounded-2xl bg-[color:var(--success)] py-2.5 text-sm font-bold text-black disabled:opacity-50"
                >
                  {busy ? "Inatuma..." : "Deposit"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Withdraw modal */}
      {modal === "withdraw" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={closeModal}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t("wallet.withdraw")}</h3>
              <button onClick={closeModal} className="rounded-full p-1 hover:bg-secondary/40"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-4 block text-xs text-muted-foreground">{t("wallet.amountUsd")}</label>
            <input
              type="number" min="0" step="0.01"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm"
              autoFocus
            />
            <button
              disabled={busy}
              onClick={submitWithdraw}
              className="mt-5 w-full rounded-2xl bg-[color:var(--danger)] py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? t("wallet.processing") : t("wallet.withdrawBtn")}
            </button>
          </div>
        </div>
      )}

      {/* Recent deposits */}
      <section className="mt-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Deposits za karibuni</h2>
        <div className="mt-2 space-y-2">
          {deposits.length === 0 ? (
            <div className="card-premium p-4 text-sm text-muted-foreground">Hakuna deposit bado.</div>
          ) : deposits.map((d) => (
            <div key={d.id} className="card-premium flex items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold tracking-tight">TZS {Number(d.amount_tzs).toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">
                  {d.channel ?? "—"} · {new Date(d.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${
                  d.status === "SUCCESS"
                    ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                    : ["FAILED", "CANCELLED", "REJECTED", "EXPIRED"].includes(d.status)
                    ? "bg-[color:var(--danger)]/15 text-[color:var(--danger)]"
                    : "bg-secondary/40 text-muted-foreground"
                }`}>{d.status}</span>
                <span className="font-mono">${Number(d.amount_usd).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent trades */}
      <section className="mt-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">{t("wallet.recentTrades")}</h2>
        <div className="mt-2 space-y-2">
          {trades.length === 0 ? (
            <div className="card-premium p-4 text-sm text-muted-foreground">{t("wallet.noTrades")}</div>
          ) : trades.map((t2) => (
            <div key={t2.id} className="card-premium flex items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold tracking-tight">{t2.symbol}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(t2.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${t2.side === "buy" ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-[color:var(--danger)]/15 text-[color:var(--danger)]"}`}>{t2.side}</span>
                <span className="font-mono">${Number(t2.price).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
