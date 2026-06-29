import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import ForexChart from "@/components/ForexChart";
import { useTranslation } from "react-i18next";

const SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD"];

export const Route = createFileRoute("/chart")({
  head: () => ({
    meta: [
      { title: "Live Charts · TeoForex" },
      { name: "description", content: "Realistic simulated forex & crypto candlestick charts with RSI, MACD and live ticks." },
    ],
  }),
  component: ChartPage,
});

function ChartPage() {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState("EUR/USD");
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-16">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">{t("chart.kicker")}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("chart.title")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("chart.subtitle")}</p>
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${symbol === s ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-background/60 text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <ForexChart key={symbol} symbol={symbol} initialTimeframe="5m" height={520} />
    </div>
  );
}
