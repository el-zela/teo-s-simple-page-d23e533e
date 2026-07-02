import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { ChatbotWidget } from "@/components/chatbot-widget";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { AuthModalProvider } from "@/components/auth-modal";
import { LanguagePickerModal } from "@/components/language-picker-modal";
import { SplashScreen } from "@/components/splash-screen";
import i18n, { getStoredLanguage } from "@/i18n";
import { setupGlobalErrorLogging } from "@/lib/error-logger";

function RouteProgress() {
  const isLoading = useRouterState({ select: (s) => s.isLoading || s.isTransitioning });
  return (
    <div
      aria-hidden
      className={`fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-primary transition-transform duration-300 ${
        isLoading ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
      }`}
      style={{ boxShadow: "0 0 12px var(--primary)" }}
    />
  );
}

function PageFade({ children }: { children: ReactNode }) {
  const location = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={location} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
      {children}
    </div>
  );
}

function NotFoundComponent() {
  const navigate = useNavigate();
  useEffect(() => {
    const id = window.setTimeout(() => navigate({ to: "/", replace: true }), 1200);
    return () => window.clearTimeout(id);
  }, [navigate]);

  return (
    <div className="mx-auto max-w-md px-4 pt-10">
      <div className="card-premium p-5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Redirecting home</h1>
        <p className="mt-2 text-sm text-muted-foreground">This route is unavailable, so the platform is restoring a safe workspace.</p>
        <div className="mt-5">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    const id = window.setTimeout(() => {
      router.invalidate();
      reset();
    }, 1000);
    return () => window.clearTimeout(id);
  }, [router, reset]);

  return (
    <div className="mx-auto max-w-md px-4 pt-10">
      <div className="card-premium p-5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Restoring workspace
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A section failed safely. The platform is retrying automatically.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TeoForex AI signals — Premium FinTech Trading Ecosystem" },
      { name: "description", content: "TeoForex AI signals combines live charts, AI signals, copy trading, premium wallets and social fintech features in one platform." },
      { name: "author", content: "TeoForex AI signals" },
      { property: "og:title", content: "TeoForex AI signals — Premium FinTech Trading Ecosystem" },
      { property: "og:description", content: "TeoForex AI signals combines live charts, AI signals, copy trading, premium wallets and social fintech features in one platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@TeoForexAI" },
      { name: "twitter:title", content: "TeoForex AI signals — Premium FinTech Trading Ecosystem" },
      { name: "twitter:description", content: "TeoForex AI signals combines live charts, AI signals, copy trading, premium wallets and social fintech features in one platform." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/85220c34-1369-4677-94d3-b9b520080ed4/id-preview-f1886226--1041bd17-b7d5-4d8f-bfe1-ecec5d1a57f8.lovable.app-1779188645401.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/85220c34-1369-4677-94d3-b9b520080ed4/id-preview-f1886226--1041bd17-b7d5-4d8f-bfe1-ecec5d1a57f8.lovable.app-1779188645401.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setupGlobalErrorLogging();
    const stored = getStoredLanguage();
    if (stored && i18n.language !== stored) {
      void i18n.changeLanguage(stored);
    }
    // Hide TradingView attribution logo injected by lightweight-charts
    function hideTvLogo() {
      document.querySelectorAll<HTMLElement>("#tv-attr-logo").forEach((el) => {
        el.style.display = "none";
      });
    }
    hideTvLogo();
    const observer = new MutationObserver(hideTvLogo);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthModalProvider>
        <RouteProgress />
        <div className="min-h-screen pb-20">
          <GlobalErrorBoundary name="AppShell" resetKey={location}>
            <PageFade>
              <Outlet />
            </PageFade>
          </GlobalErrorBoundary>
        </div>
        <div className="min-h-screen pb-20">
          <GlobalErrorBoundary name="AppShell" resetKey={location}>
            <PageFade>
              <ClientOnly>
                <Outlet />
              </ClientOnly>
            </PageFade>
          </GlobalErrorBoundary>
        </div>
        <ClientOnly>
          <GlobalErrorBoundary name="BottomNav" resetKey={location}><BottomNav /></GlobalErrorBoundary>
          <GlobalErrorBoundary name="ChatbotWidget"><ChatbotWidget /></GlobalErrorBoundary>
          <LanguagePickerModal />
        </ClientOnly>
        <SplashScreen />
        <Toaster theme="dark" position="top-right" richColors />
      </AuthModalProvider>
    </QueryClientProvider>
  );
}
