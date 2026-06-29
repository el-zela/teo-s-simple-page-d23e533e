import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isValidPhone, phoneToEmail } from "@/lib/phone-auth";
import { logAppError } from "@/lib/error-logger";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPhone(phone)) return toast.error(t("auth.phoneInvalid"));
    if (!password) return toast.error(t("auth.enterPassword"));
    setLoading(true);
    const email = phoneToEmail(phone);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + "/" },
      });
      if (error) return toast.error(error.message);
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) return toast.error(signInErr.message);
      toast.success(t("auth.accountCreated"));
      navigate({ to: "/" });
    } catch (error) {
      logAppError(error, { component: "SignupPage", action: "sign-up", service: "auth" });
      toast.error(t("auth.signupFailedToast"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6 bg-background">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-card">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">{t("common.back")}</Link>
        <h1 className="mt-3 text-3xl font-semibold">{t("auth.openAccount")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.signupSubtitle")}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">{t("auth.phoneLabel")}</label>
            <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255712345678"
              className="mt-1 w-full rounded-3xl border border-border bg-input/40 px-4 py-3 text-base outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t("auth.password")}</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-3xl border border-border bg-input/40 px-4 py-3 text-base outline-none focus:border-primary" />
          </div>
          <button disabled={loading} className="w-full rounded-3xl bg-primary py-3 text-sm font-semibold text-primary-foreground glow disabled:opacity-50">
            {loading ? t("auth.openingAccount") : t("auth.openAccount")}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {t("auth.alreadyHave")} <Link to="/login" className="text-primary hover:underline">{t("auth.signIn")}</Link>
        </p>
      </div>
    </div>
  );
}
