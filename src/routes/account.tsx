import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { ChevronDown, LogOut, User as UserIcon, Globe } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getAccountStats } from "@/lib/stats.functions";
import { logAppError } from "@/lib/error-logger";
import { useTranslation } from "react-i18next";
import { setAppLanguage, type AppLanguage } from "@/i18n";

export const Route = createFileRoute("/account")({
  component: AccountPage,
});

type Stats = { open: number; closed: number; total_trades: number; total_pnl: number };

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-premium overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold tracking-tight">
        <span>{title}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="divider-silver mx-4" />}
      {open && <div className="px-4 py-3 text-sm">{children}</div>}
    </div>
  );
}

function AccountPage() {
  const { t, i18n } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const loadStats = useServerFn(getAccountStats);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setDataLoading(true);
    loadStats().then((value) => {
      if (!cancelled) setStats(value);
      if (!cancelled) setDataError(null);
    }).catch((error) => {
      logAppError(error, { component: "AccountPage", action: "load", service: "account-data" });
      if (!cancelled) setDataError(t("account.delayed"));
    }).finally(() => {
      if (!cancelled) setDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, loadStats, t]);

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-muted-foreground">{t("common.loading")}</div>;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("account.title")}</h1>
        <div className="mt-4"><AuthGate title={t("account.gateTitle")} message={t("account.gateMessage")} /></div>
      </div>
    );
  }

  async function logout() {
    await supabase.auth.signOut();
    toast.success(t("auth.loggedOut"));
    navigate({ to: "/" });
  }

  function pickLang(lang: AppLanguage) {
    setAppLanguage(lang);
    toast.success(t("language.changed"));
  }

  const phone = "+" + (user.email ?? "").split("@")[0];
  const currentLang = (i18n.language?.startsWith("sw") ? "sw" : "en") as AppLanguage;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-5 pb-28">
      <div className="card-premium card-premium-strong flex items-center gap-3 p-4">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <UserIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold tracking-tight text-shimmer">{phone}</p>
          <p className="text-xs text-muted-foreground">{t("account.tier")}</p>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background/70 px-3 py-2 text-xs">
          <LogOut className="h-4 w-4" /> {t("account.logout")}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <div className="card-premium p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("account.open")}</p>
          <p className="mt-1 font-mono text-lg font-bold text-shimmer">{stats?.open ?? 0}</p>
        </div>
        <div className="card-premium p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("account.trades")}</p>
          <p className="mt-1 font-mono text-lg font-bold text-shimmer">{stats?.total_trades ?? 0}</p>
        </div>
        <div className="card-premium p-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("account.pnl")}</p>
          <p className={`mt-1 font-mono text-lg font-bold ${(stats?.total_pnl ?? 0) >= 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}`}>
            {(stats?.total_pnl ?? 0) >= 0 ? "+" : ""}${(stats?.total_pnl ?? 0).toFixed(2)}
          </p>
        </div>
      </div>
      {dataLoading && <div className="mt-4 card-premium h-16 animate-pulse" />}
      {dataError && <div className="mt-4 card-premium p-3 text-sm text-muted-foreground">{dataError}</div>}

      <div className="mt-5 space-y-2.5">
        <div className="card-premium p-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold tracking-tight">{t("account.language")}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("account.languageDesc")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => pickLang("en")}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${currentLang === "en" ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground"}`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => pickLang("sw")}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${currentLang === "sw" ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground"}`}
            >
              Kiswahili
            </button>
          </div>
        </div>


        <Section title={t("account.subscription")}>
          <p className="font-semibold">{t("account.tier")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("account.subDesc")}</p>
        </Section>

        <Section title={t("account.trust")}>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>✓ {t("account.trustVerified")}</li>
            <li>✓ {t("account.trustTop")}</li>
            <li>✓ {t("account.trustAml")}</li>
          </ul>
        </Section>

        <Section title={t("account.info")}>
          <p className="text-xs text-muted-foreground">{t("account.phone")}</p>
          <p className="font-mono text-sm">{phone}</p>
          <p className="mt-3 text-xs text-muted-foreground">{t("account.userId")}</p>
          <p className="font-mono text-[11px] break-all">{user.id}</p>
        </Section>
      </div>
    </div>
  );
}
