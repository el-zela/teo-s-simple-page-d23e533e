import { useAuthModal } from "@/components/auth-modal";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AuthGate({ title, message }: { title?: string; message?: string }) {
  const { openSignIn, openSignUp } = useAuthModal();
  const { t } = useTranslation();

  return (
    <div className="glass rounded-2xl p-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
        <Lock className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title ?? t("auth.gateTitle")}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
        {message ?? t("auth.gateMessage")}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={openSignUp}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow"
        >
          {t("auth.createAccount")}
        </button>
        <button
          type="button"
          onClick={openSignIn}
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-secondary/40"
        >
          {t("auth.signIn")}
        </button>
      </div>
    </div>
  );
}
