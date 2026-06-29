import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ArrowDownRight, ArrowUpRight, X, ChevronDown, Check } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { useServerFn } from "@tanstack/react-start";
import { depositFunds, withdrawFunds } from "@/lib/wallet.functions";
import { toast } from "sonner";
import { logAppError } from "@/lib/error-logger";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

type Wallet = { id: string; type: string; balance: number; currency: string };
type Trade = { id: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; status: string; created_at: string };

const walletTypes = [
  { key: "main", label: "Main" },
  { key: "trading", label: "Trading" },
  { key: "reward", label: "Reward" },
  { key: "affiliate", label: "Affiliate" },
] as const;

type WalletKey = typeof walletTypes[number]["key"];

function WalletPage() {
  const { t } = useTranslation();
  const walletTypeLabels: Record<WalletKey, string> = {
    main: t("wallet.types.main"),
    trading: t("wallet.types.trading"),
    reward: t("wallet.types.reward"),
    affiliate: t("wallet.types.affiliate"),
  };
  const { user, loading } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [modal, setModal] = useState<null | "deposit" | "withdraw">(null);
  const [amount, setAmount] = useState("");
  const [walletType, setWalletType] = useState<WalletKey>("main");
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const runDeposit = useServerFn(depositFunds);
  const runWithdraw = useServerFn(withdrawFunds);

  async function refreshWallets() {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("wallets").select("*").eq("user_id", user.id);
      if (error) throw error;
      setWallets((data ?? []) as Wallet[]);
      setDataError(null);
    } catch (error) {
      logAppError(error, { component: "WalletPage", action: "refresh-wallets", service: "wallets" });
      setDataError("Wallet data delayed. Auto-recovery is active.");
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setDataLoading(true);
    Promise.all([
      refreshWallets(),
      supabase.from("trades").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)
        .then(({ data, error }) => {
          if (error) throw error;
          if (!cancelled) setTrades((data ?? []) as Trade[]);
        }),
    ]).catch((error) => {
      logAppError(error, { component: "WalletPage", action: "load", service: "wallet/trades" });
      if (!cancelled) setDataError("Wallet data delayed. Auto-recovery is active.");
    }).finally(() => {
      if (!cancelled) setDataLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function submitMoneyOp() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error(t("common.enterValidAmount"));
    if (busy || !modal) return;
    setBusy(true);
    const idem = `${modal}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const fn = modal === "deposit" ? runDeposit : runWithdraw;
      const res = await fn({ data: { wallet_type: walletType, amount: amt, idempotency_key: idem } });
      if (!res.ok) {
        toast.error(res.error === "insufficient_funds" ? t("common.insufficient") : res.error);
      } else {
        toast.success(modal === "deposit" ? t("wallet.depositedToast", { amt: amt.toFixed(2) }) : t("wallet.withdrewToast", { amt: amt.toFixed(2) }));
        setAmount("");
        setModal(null);
        await refreshWallets();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const walletSummary = useMemo(() => walletTypes.map(({ key }) => {
    const w = wallets.find((item) => item.type.toLowerCase() === key);
    return { key, label: walletTypeLabels[key], balance: w?.balance ?? 0, currency: w?.currency ?? "USD" };
  }), [wallets, walletTypeLabels]);

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
            onClick={() => { setModal("deposit"); setWalletType("main"); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[color:var(--success)] px-3 py-2 text-xs font-bold text-black"
          >
            <ArrowDownRight className="h-4 w-4" /> {t("wallet.deposit")}
          </button>
          <button
            onClick={() => { setModal("withdraw"); setWalletType("main"); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[color:var(--danger)] px-3 py-2 text-xs font-bold text-white"
          >
            <ArrowUpRight className="h-4 w-4" /> {t("wallet.withdraw")}
          </button>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !busy && setModal(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold capitalize">{modal === "deposit" ? t("wallet.deposit") : t("wallet.withdraw")}</h3>
              <button onClick={() => !busy && setModal(null)} className="rounded-full p-1 hover:bg-secondary/40"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-4 block text-xs text-muted-foreground">{t("wallet.wallet")}</label>
            <UpwardSelect
              value={walletType}
              onChange={(v) => setWalletType(v)}
              options={walletTypes.map((w) => ({ value: w.key, label: walletTypeLabels[w.key] }))}
            />
            <label className="mt-4 block text-xs text-muted-foreground">{t("wallet.amountUsd")}</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm" autoFocus />
            <button
              disabled={busy}
              onClick={submitMoneyOp}
              className={`mt-5 w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-50 ${
                modal === "deposit"
                  ? "bg-[color:var(--success)] text-black"
                  : "bg-[color:var(--danger)] text-white"
              }`}
            >
              {busy ? t("wallet.processing") : modal === "deposit" ? t("wallet.depositBtn") : t("wallet.withdrawBtn")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {walletSummary.map((w) => (
          <div key={w.key} className="card-premium p-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{w.label}</p>
            <p className="mt-2 font-mono text-base font-bold leading-tight text-shimmer sm:text-lg">
              ${w.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-muted-foreground">{w.currency}</p>
          </div>
        ))}
      </div>
      {dataLoading && <div className="mt-4 card-premium h-20 animate-pulse" />}
      {dataError && <div className="mt-4 card-premium p-3 text-sm text-muted-foreground">{t("wallet.delayed")}</div>}

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

function UpwardSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-input/40 px-3 py-2 text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-medium">{current?.label ?? "Select"}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-64 overflow-auto rounded-2xl border border-border bg-popover p-1 shadow-xl"
          >
            {options.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
                      active ? "bg-primary/15 text-primary" : "hover:bg-secondary/40 text-foreground"
                    }`}
                  >
                    <span>{o.label}</span>
                    {active && <Check className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
