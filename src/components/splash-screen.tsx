import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

const SPLASH_MS = 2500;

export function SplashScreen() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), SPLASH_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background transition-opacity duration-500 ease-out ${
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse" />
        <img
          src="/splash-logo.png"
          alt="TeoForex"
          width={160}
          height={160}
          className="relative h-40 w-40 rounded-full object-contain animate-in zoom-in-50 duration-700"
        />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          TeoForex AI signals
        </h1>
        <p className="mt-2 text-xs uppercase tracking-[0.35em] text-muted-foreground">
          Premium FinTech
        </p>
      </div>
      <div className="mt-2 h-1 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 animate-[splash-bar_2.5s_ease-in-out_infinite] bg-primary" />
      </div>
      <style>{`
        @keyframes splash-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
