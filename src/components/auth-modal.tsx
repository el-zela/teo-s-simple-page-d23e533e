"use client";

import * as React from "react";
import { useMemo, useState, createContext, useContext, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isValidPhone, phoneToEmail } from "@/lib/phone-auth";
import { logAppError } from "@/lib/error-logger";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type AuthMode = "signIn" | "signUp";

interface AuthModalContextValue {
  openSignIn: () => void;
  openSignUp: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");

  const value = useMemo(
    () => ({
      openSignIn: () => {
        setMode("signIn");
        setOpen(true);
      },
      openSignUp: () => {
        setMode("signUp");
        setOpen(true);
      },
    }),
    [],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal open={open} mode={mode} onOpenChange={setOpen} setMode={setMode} />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within AuthModalProvider");
  }
  return context;
}

function phoneToAuthEmail(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  if (!isValidPhone(raw)) return "";
  return phoneToEmail(raw);
}

function AuthModal({
  open,
  onOpenChange,
  mode,
  setMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
}) {
  const isSignup = mode === "signUp";
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
    setRememberMe(true);
    setLoading(false);
  }, [open, mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = phoneToAuthEmail(email);

    if (!normalizedEmail) {
      return toast.error(t("auth.phoneInvalid"));
    }

    if (!password) {
      return toast.error(t("auth.enterPassword"));
    }

    if (isSignup) {
      if (!fullName.trim()) {
        return toast.error(t("auth.enterName"));
      }
      if (password !== confirmPassword) {
        return toast.error(t("auth.passwordMismatch"));
      }
    }

    setLoading(true);

    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: fullName.trim(),
            },
          },
        });

        if (error) {
          return toast.error(error.message);
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError) {
          return toast.error(signInError.message);
        }

        toast.success(t("auth.accountCreated"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) {
          return toast.error(error.message);
        }

        toast.success(t("auth.signedIn"));
      }

      onOpenChange(false);
    } catch (error) {
      logAppError(error, { component: "AuthModal", action: isSignup ? "sign-up" : "sign-in", service: "auth" });
      toast.error(isSignup ? t("auth.signUpFailed") : t("auth.signInFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const normalizedEmail = phoneToAuthEmail(email);
    if (!normalizedEmail) {
      return toast.error(t("auth.resetEmailHint"));
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: window.location.origin,
      });
      if (error) return toast.error(error.message);
      toast.success(t("auth.resetSent"));
    } catch (error) {
      logAppError(error, { component: "AuthModal", action: "forgot-password", service: "auth" });
      toast.error(t("auth.resetFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="auth-modal-panel z-[100] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg p-5 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:p-8"
      >
        <DialogHeader className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-3xl font-semibold tracking-tight">
                {isSignup ? t("auth.signUpTitle") : t("auth.signInTitle")}
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-sm text-muted-foreground">
                {isSignup ? t("auth.signUpDesc") : t("auth.signInDesc")}
              </DialogDescription>
            </div>
            <div className="inline-flex rounded-full bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setMode("signIn")}
                className={cn(
                  "inline-flex min-w-[106px] items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition",
                  isSignup
                    ? "text-muted-foreground hover:text-foreground"
                    : "bg-white/10 text-white shadow-sm ring-1 ring-white/15",
                )}
              >
                {t("auth.signIn")}
              </button>
              <button
                type="button"
                onClick={() => setMode("signUp")}
                className={cn(
                  "inline-flex min-w-[106px] items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition",
                  isSignup
                    ? "bg-white/10 text-white shadow-sm ring-1 ring-white/15"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("auth.signUp")}
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignup && (
              <label className="block text-sm font-medium text-foreground">
                {t("auth.fullName")}
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder={t("auth.fullNamePh")}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
                />
              </label>
            )}

            <label className="block text-sm font-medium text-foreground">
              {t("auth.email")}
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("auth.emailPh")}
                className="mt-2 w-full rounded-3xl border border-white/10 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
              />
            </label>

            <label className="block text-sm font-medium text-foreground">
              {t("auth.password")}
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 w-full rounded-3xl border border-white/10 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
              />
            </label>

            {isSignup && (
              <label className="block text-sm font-medium text-foreground">
                {t("auth.confirmPassword")}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-background/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
                />
              </label>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
                />
                {t("auth.rememberMe")}
              </label>
              {!isSignup && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-sm font-semibold text-primary hover:text-primary/80"
                  disabled={loading}
                >
                  {t("auth.forgotPassword")}
                </button>
              )}
            </div>

            <Button type="submit" className="w-full rounded-3xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-glow" size="lg">
              {loading ? (isSignup ? t("auth.creating") : t("auth.signingIn")) : isSignup ? t("auth.createAccountBtn") : t("auth.signIn")}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {isSignup ? (
              <>
                {t("auth.alreadyHave")}{' '}
                <button type="button" className="font-semibold text-primary hover:text-primary/80" onClick={() => setMode("signIn")}>{t("auth.signIn")}</button>
              </>
            ) : (
              <>
                {t("auth.newHere")}{' '}
                <button type="button" className="font-semibold text-primary hover:text-primary/80" onClick={() => setMode("signUp")}>{t("auth.createAccount")}</button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
