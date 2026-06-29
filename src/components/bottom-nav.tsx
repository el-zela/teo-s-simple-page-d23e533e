import { Link, useLocation } from "@tanstack/react-router";
import { LineChart, Bot, Wallet, User } from "lucide-react";
import { useTranslation } from "react-i18next";

export function BottomNav() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const items = [
    { to: "/", label: t("nav.home"), icon: LineChart },
    { to: "/signals", label: t("nav.signals"), icon: Bot },
    { to: "/wallet", label: t("nav.wallet"), icon: Wallet },
    { to: "/account", label: t("nav.profile"), icon: User },
  ] as const;

  return (
    <nav
      className="bottom-nav-shell fixed inset-x-0 bottom-0 z-40 border-t border-border pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {items.map((it) => {
          const active = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                className={`flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[11px] transition ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "drop-shadow-[0_0_6px_currentColor]" : ""}`} />
                <span className="font-medium tracking-wide">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
