import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { logAppError, notifyRecoverableError } from "@/lib/error-logger";
import {
  TIMEFRAME_SECONDS,
  type Timeframe,
  type Candle,
  type FxSymbol,
  FX_SYMBOL_META,
  alignBar,
  buildCandle,
  buildHistory,
  priceAt,
  sessionAt,
  ema,
  rsi as rsiCalc,
  macd as macdCalc,
} from "@/lib/forex-sim";

type Props = {
  symbol: string;
  initialTimeframe?: Timeframe;
  height?: number;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1H", "4H", "1D"];
const INITIAL_BARS = 500;
const EXTEND_CHUNK = 300;
const MAX_BARS = 5000;

export default function ForexChart({ symbol, initialTimeframe = "5m", height = 520, entryPrice, stopLoss, takeProfit }: Props) {
  const [tf, setTf] = useState<Timeframe>(initialTimeframe);
  const [showMA, setShowMA] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rsiRef = useRef<HTMLDivElement | null>(null);
  const macdRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const macdChartRef = useRef<IChartApi | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const historyRef = useRef<Candle[]>([]);
  const liveBarStartRef = useRef<number>(0);
  const extendingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const chartKeyRef = useRef("");

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [spread, setSpread] = useState(0);
  const [change24h, setChange24h] = useState(0);
  const [sessionLabel, setSessionLabel] = useState<string>("");
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chartError, setChartError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const fx = symbol as FxSymbol;
  const meta = FX_SYMBOL_META[fx];
  const decimals = meta?.decimals ?? 5;
  const pip = meta?.pip ?? 0.0001;

  function cleanupCharts() {
    try { chartRef.current?.remove(); } catch (error) { logAppError(error, { component: "ForexChart", action: "remove-main-chart" }); }
    try { rsiChartRef.current?.remove(); } catch (error) { logAppError(error, { component: "ForexChart", action: "remove-rsi-chart" }); }
    try { macdChartRef.current?.remove(); } catch (error) { logAppError(error, { component: "ForexChart", action: "remove-macd-chart" }); }
    chartRef.current = null;
    candleRef.current = null;
    volRef.current = null;
    ema20Ref.current = null;
    ema50Ref.current = null;
    ema200Ref.current = null;
    rsiChartRef.current = null;
    rsiSeriesRef.current = null;
    macdChartRef.current = null;
    macdLineRef.current = null;
    macdSignalRef.current = null;
    macdHistRef.current = null;
  }

  // Build / rebuild chart on tf or symbol change
  useEffect(() => {
    if (!containerRef.current || !meta) return;
    const chartKey = `${symbol}:${tf}:${height}:${showRSI}:${showMACD}`;
    if (chartKeyRef.current !== chartKey) {
      chartKeyRef.current = chartKey;
      retryCountRef.current = 0;
    }
    setChartStatus("loading");
    setChartError(null);
    cleanupCharts();

    try {

    const pad = (n: number) => String(n).padStart(2, "0");
    const localTimeFormatter = (t: Time) => {
      const d = new Date((t as number) * 1000);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const localTickFormatter = (t: Time) => {
      const d = new Date((t as number) * 1000);
      if (tf === "1D") return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
      if (tf === "4H" || tf === "1H") return `${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(220,225,240,0.85)",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      localization: {
        locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
        timeFormatter: localTimeFormatter,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.08, bottom: 0.18 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: tf !== "1D",
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        tickMarkFormatter: localTickFormatter,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(120,200,255,0.4)", width: 1, style: 2, labelBackgroundColor: "#0ea5e9" },
        horzLine: { color: "rgba(120,200,255,0.4)", width: 1, style: 2, labelBackgroundColor: "#0ea5e9" },
      },
      // Wheel pans, NEVER zooms. Pinch zoom on touch + dedicated buttons handle zoom.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
      },
      kineticScroll: { touch: true, mouse: false },
      autoSize: true,
    });


    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10d29a",
      downColor: "#ef4d6a",
      borderUpColor: "#10d29a",
      borderDownColor: "#ef4d6a",
      wickUpColor: "#10d29a",
      wickDownColor: "#ef4d6a",
      priceFormat: { type: "price", precision: decimals, minMove: pip },
      priceLineVisible: true,
      priceLineColor: "rgba(120,200,255,0.6)",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(120,200,255,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const e20  = chart.addSeries(LineSeries, { color: "#facc15", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "EMA20" });
    const e50  = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "EMA50" });
    const e200 = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "EMA200" });

    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;
    ema20Ref.current = e20;
    ema50Ref.current = e50;
    ema200Ref.current = e200;

    // Build initial data
    const tfSec = TIMEFRAME_SECONDS[tf];
    const now = Math.floor(Date.now() / 1000);
    const liveStart = alignBar(now, tfSec);
    liveBarStartRef.current = liveStart;
    const closed = buildHistory(fx, tfSec, liveStart, INITIAL_BARS);
    const live = buildCandle(fx, tfSec, liveStart, now);
    historyRef.current = [...closed, live];
    pushAll();

    // RSI pane
    if (showRSI && rsiRef.current) {
      const rsiChart = createChart(rsiRef.current, {
        height: 110,
        layout: { background: { color: "transparent" }, textColor: "rgba(220,225,240,0.7)", fontFamily: "Inter, system-ui, sans-serif" },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
        timeScale: { visible: false, borderColor: "rgba(255,255,255,0.08)" },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
        autoSize: true,
      });
      const rsiSeries = rsiChart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2, title: "RSI(14)" });
      rsiSeries.createPriceLine({ price: 70, color: "rgba(239,77,106,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "70" });
      rsiSeries.createPriceLine({ price: 30, color: "rgba(16,210,154,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "30" });
      rsiChartRef.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;
    }

    // MACD pane
    if (showMACD && macdRef.current) {
      const macdChart = createChart(macdRef.current, {
        height: 130,
        layout: { background: { color: "transparent" }, textColor: "rgba(220,225,240,0.7)", fontFamily: "Inter, system-ui, sans-serif" },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
        timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: tf !== "1D" },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
        autoSize: true,
      });
      const hist = macdChart.addSeries(HistogramSeries, { color: "rgba(120,200,255,0.5)", title: "MACD hist" });
      const line = macdChart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, title: "MACD" });
      const sig  = macdChart.addSeries(LineSeries, { color: "#facc15", lineWidth: 1, title: "Signal" });
      macdChartRef.current = macdChart;
      macdHistRef.current = hist;
      macdLineRef.current = line;
      macdSignalRef.current = sig;
    }

    // Sync time scales + detect left-edge for infinite history.
    const syncFromMain = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      rsiChartRef.current?.timeScale().setVisibleLogicalRange(range);
      macdChartRef.current?.timeScale().setVisibleLogicalRange(range);

      // Prepend more history when user scrolls near the start.
      if (range.from < 20 && !extendingRef.current) {
        extendOlderHistory();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncFromMain);

    chart.timeScale().fitContent();
    setChartStatus("ready");
    retryCountRef.current = 0;

    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromMain);
      cleanupCharts();
    };
    } catch (error) {
      const entry = logAppError(error, {
        component: "ForexChart",
        action: "initialize",
        service: "lightweight-charts",
        metadata: { symbol, timeframe: tf, retry: retryCountRef.current },
      });
      cleanupCharts();
      setChartStatus("error");
      setChartError(entry.message);
      notifyRecoverableError("Chart engine recovered safely. Retrying…");
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => setRetryVersion((v) => v + 1), 900 * retryCountRef.current);
      }
      return () => {
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        cleanupCharts();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, height, showRSI, showMACD, retryVersion]);

  function extendOlderHistory() {
    try {
      const tfSec = TIMEFRAME_SECONDS[tf];
      const hist = historyRef.current;
      if (hist.length === 0) return;
      if (hist.length >= MAX_BARS) return;
      extendingRef.current = true;
      const firstTime = hist[0].time;
      const older = buildHistory(fx, tfSec, firstTime, EXTEND_CHUNK);
      historyRef.current = [...older, ...hist].slice(-MAX_BARS);
      pushAll();
      requestAnimationFrame(() => { extendingRef.current = false; });
    } catch (error) {
      extendingRef.current = false;
      logAppError(error, { component: "ForexChart", action: "extend-history", service: "forex-sim", metadata: { symbol, timeframe: tf } });
    }
  }

  function pushAll() {
    try {
      const history = historyRef.current.filter(isValidCandle);
      historyRef.current = history;
      const candle = candleRef.current;
      const vol = volRef.current;
      if (!candle || !vol || history.length === 0) return;
      candle.setData(history.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
      vol.setData(history.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(16,210,154,0.45)" : "rgba(239,77,106,0.45)",
      })));
      setSignalMarkers();
      refreshIndicators();
    } catch (error) {
      logAppError(error, { component: "ForexChart", action: "push-data", service: "lightweight-charts", metadata: { symbol, timeframe: tf } });
      setChartStatus("error");
      setChartError("Chart data delayed");
    }
  }

  function refreshIndicators() {
    try {
      const history = historyRef.current.filter(isValidCandle);
      if (history.length === 0) return;
      const closes = history.map((c) => c.close);
      if (showMA) {
        const e20 = ema(closes, 20);
        const e50 = ema(closes, 50);
        const e200 = ema(closes, 200);
        ema20Ref.current?.setData(history.map((c, i) => e20[i] != null ? { time: c.time as UTCTimestamp, value: e20[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
        ema50Ref.current?.setData(history.map((c, i) => e50[i] != null ? { time: c.time as UTCTimestamp, value: e50[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
        ema200Ref.current?.setData(history.map((c, i) => e200[i] != null ? { time: c.time as UTCTimestamp, value: e200[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
      } else {
        ema20Ref.current?.setData([]);
        ema50Ref.current?.setData([]);
        ema200Ref.current?.setData([]);
      }
      if (rsiSeriesRef.current) {
        const r = rsiCalc(closes, 14);
        rsiSeriesRef.current.setData(history.map((c, i) => r[i] != null ? { time: c.time as UTCTimestamp, value: r[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
      }
      if (macdLineRef.current && macdSignalRef.current && macdHistRef.current) {
        const m = macdCalc(closes);
        macdLineRef.current.setData(history.map((c, i) => m.macdLine[i] != null ? { time: c.time as UTCTimestamp, value: m.macdLine[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
        macdSignalRef.current.setData(history.map((c, i) => m.signalLine[i] != null ? { time: c.time as UTCTimestamp, value: m.signalLine[i] as number } : null).filter(Boolean) as { time: Time; value: number }[]);
        macdHistRef.current.setData(history.map((c, i) => m.hist[i] != null ? { time: c.time as UTCTimestamp, value: m.hist[i] as number, color: (m.hist[i] as number) >= 0 ? "rgba(16,210,154,0.6)" : "rgba(239,77,106,0.6)" } : null).filter(Boolean) as { time: Time; value: number; color?: string }[]);
      }
    } catch (error) {
      logAppError(error, { component: "ForexChart", action: "indicators", service: "forex-sim", metadata: { symbol, timeframe: tf } });
    }
  }

  function setSignalMarkers() {
    try {
      const chart = candleRef.current;
      if (!chart) return;
      const markerTime = liveBarStartRef.current as UTCTimestamp;
      const markers = [] as Array<{
        time: UTCTimestamp;
        position: "aboveBar" | "belowBar";
        color: string;
        shape: "arrowUp" | "arrowDown" | "circle" | "cross";
        text: string;
      }>;
      if (entryPrice != null) {
        markers.push({ time: markerTime, position: "aboveBar", color: "#22c55e", shape: "circle", text: "Entry" });
      }
      if (takeProfit != null) {
        markers.push({ time: markerTime, position: "aboveBar", color: "#38bdf8", shape: "arrowUp", text: "TP" });
      }
      if (stopLoss != null) {
        markers.push({ time: markerTime, position: "belowBar", color: "#ef4444", shape: "arrowDown", text: "SL" });
      }
      (chart as any).setMarkers?.(markers as any);
    } catch (error) {
      logAppError(error, { component: "ForexChart", action: "set-markers", service: "lightweight-charts", metadata: { symbol, entryPrice, stopLoss, takeProfit } });
    }
  }

  // Real-clock tick loop. Updates live bar each second; rolls to next bar at wall-clock boundary.
  useEffect(() => {
    if (!meta) return;
    const tfSec = TIMEFRAME_SECONDS[tf];
    let cancelled = false;

    function tick() {
      try {
        if (cancelled) return;
        const candle = candleRef.current; const vol = volRef.current;
        if (!candle || !vol) return;
        const now = Math.floor(Date.now() / 1000);
        const expectedStart = alignBar(now, tfSec);
        const hist = historyRef.current;

      // Close any bars that have elapsed (handles dropped frames / tab sleep)
      while (liveBarStartRef.current < expectedStart) {
        const closedStart = liveBarStartRef.current;
        const closed = buildCandle(fx, tfSec, closedStart);
        // replace last (live) with closed
        if (hist.length && hist[hist.length - 1].time === closedStart) {
          hist[hist.length - 1] = closed;
        } else {
          hist.push(closed);
        }
        candle.update({ time: closed.time as UTCTimestamp, open: closed.open, high: closed.high, low: closed.low, close: closed.close });
        vol.update({ time: closed.time as UTCTimestamp, value: closed.volume, color: closed.close >= closed.open ? "rgba(16,210,154,0.45)" : "rgba(239,77,106,0.45)" });
        liveBarStartRef.current = closedStart + tfSec;
        // open fresh live bar
        const fresh = buildCandle(fx, tfSec, liveBarStartRef.current, now);
        hist.push(fresh);
        candle.update({ time: fresh.time as UTCTimestamp, open: fresh.open, high: fresh.high, low: fresh.low, close: fresh.close });
        vol.update({ time: fresh.time as UTCTimestamp, value: fresh.volume, color: fresh.close >= fresh.open ? "rgba(16,210,154,0.45)" : "rgba(239,77,106,0.45)" });
        if (hist.length > MAX_BARS) hist.shift();
        refreshIndicators();
      }

      // Update current live bar
      const liveStart = liveBarStartRef.current;
      const live = buildCandle(fx, tfSec, liveStart, now);
      if (hist.length && hist[hist.length - 1].time === liveStart) {
        hist[hist.length - 1] = live;
      } else {
        hist.push(live);
      }
      candle.update({ time: live.time as UTCTimestamp, open: live.open, high: live.high, low: live.low, close: live.close });
      vol.update({ time: live.time as UTCTimestamp, value: live.volume, color: live.close >= live.open ? "rgba(16,210,154,0.45)" : "rgba(239,77,106,0.45)" });

      const px = live.close;
      setLivePrice(px);
      setSpread(meta.pip * (1.2 + Math.random() * 0.6));
      setSessionLabel(sessionAt(now));

      // 24h change
        const day = priceAt(fx, now - 86400);
        setChange24h(((px - day) / day) * 100);
        setChartStatus("ready");
        setChartError(null);
      } catch (error) {
        logAppError(error, { component: "ForexChart", action: "live-tick", service: "forex-sim", metadata: { symbol, timeframe: tf } });
        setChartStatus("error");
        setChartError("Live chart tick delayed");
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf]);

  useEffect(() => {
    function hideLogo() {
      document.querySelectorAll<HTMLElement>("#tv-attr-logo").forEach((el) => {
        el.style.display = "none";
      });
    }
    hideLogo();
    const id = setInterval(hideLogo, 500);
    return () => clearInterval(id);
  }, []);

  // Toggle MA visibility without rebuilding
  useEffect(() => { refreshIndicators(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showMA]);

  const priceFmt = useMemo(() => {
    const p = livePrice ?? 0;
    return p.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }, [livePrice, decimals]);

  const up = change24h >= 0;
  const spreadPips = (spread / pip).toFixed(1);

  function zoomBy(factor: number) {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2;
    const halfNew = ((range.to - range.from) / 2) * factor;
    ts.setVisibleLogicalRange({ from: center - halfNew, to: center + halfNew });
  }
  function resetZoom() { chartRef.current?.timeScale().fitContent(); }

  if (!meta) {
    return (
      <div className="card-premium p-6 text-sm text-muted-foreground">
        Symbol "{symbol}" haitumiki. Tumia EUR/USD, GBP/USD, USD/JPY, USD/CHF au AUD/USD.
      </div>
    );
  }

  return (
    <div className="card-premium overflow-hidden">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-background/40 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight">{symbol}</span>
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">SIM · {sessionLabel.toUpperCase()}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span
            className={`text-xl font-bold tabular-nums transition-colors ${up ? "text-[color:var(--success,oklch(0.78_0.18_160))]" : "text-[color:var(--danger,oklch(0.68_0.24_20))]"}`}
            style={{ textShadow: up ? "0 0 18px rgba(16,210,154,0.45)" : "0 0 18px rgba(239,77,106,0.45)" }}
          >
            {priceFmt}
          </span>
          <span className={`text-xs font-semibold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
            {up ? "▲" : "▼"} {change24h.toFixed(2)}%
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background/60 p-1">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${tf === t ? "bg-primary text-primary-foreground shadow-[0_0_18px_rgba(16,210,154,0.4)]" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background/60 p-1">
            <button onClick={() => zoomBy(0.7)} aria-label="Zoom in" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
            <button onClick={() => zoomBy(1.4)} aria-label="Zoom out" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"><Minus className="h-3.5 w-3.5" /></button>
            <button onClick={resetZoom} aria-label="Fit" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"><Maximize2 className="h-3.5 w-3.5" /></button>
          </div>
          <Toggle label="MA" on={showMA} onChange={setShowMA} />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 bg-background/30 px-4 py-2 text-[11px] sm:grid-cols-4">
        <Stat label="Spread" value={`${spreadPips} pips`} />
        <Stat label="Bid" value={(livePrice ? livePrice - spread / 2 : 0).toFixed(decimals)} />
        <Stat label="Ask" value={(livePrice ? livePrice + spread / 2 : 0).toFixed(decimals)} />
        <Stat label="Session" value={sessionLabel} />
      </div>

      {/* Chart panes */}
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full [&_canvas]:!cursor-crosshair" />
        {chartStatus !== "ready" && (
          <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-sm">
            <div className="card-premium max-w-xs p-4 text-center text-sm">
              <div className="mx-auto mb-3 h-2 w-28 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70" />
              </div>
              <p className="font-semibold text-foreground">
                {chartStatus === "loading" ? "Loading market chart…" : "Restoring chart…"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {chartError ?? "Historical candles and indicators are syncing safely."}
              </p>
            </div>
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-b-2xl"
          style={{
            background:
              "radial-gradient(120% 60% at 50% 0%, rgba(56,189,248,0.06), transparent 60%), radial-gradient(80% 50% at 100% 100%, rgba(168,85,247,0.05), transparent 60%)",
          }}
        />
      </div>
      {showRSI && <div ref={rsiRef} className="w-full border-t border-border/60" style={{ height: 110 }} />}
      {showMACD && <div ref={macdRef} className="w-full border-t border-border/60" style={{ height: 130 }} />}
    </div>
  );
}

function isValidCandle(c: Candle): boolean {
  return Boolean(
    c &&
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    Number.isFinite(c.volume) &&
    c.high >= c.low,
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "border-primary/60 bg-primary/15 text-primary shadow-[0_0_12px_rgba(16,210,154,0.25)]" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/50 px-2.5 py-1.5">
      <span className="uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums capitalize">{value}</span>
    </div>
  );
}
