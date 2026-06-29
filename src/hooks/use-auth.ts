import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logAppError } from "@/lib/error-logger";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        setSession(s);
        setLoading(false);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      }).catch((error) => {
        logAppError(error, { component: "useAuth", action: "getSession", service: "auth" });
        setSession(null);
        setLoading(false);
      });
    } catch (error) {
      logAppError(error, { component: "useAuth", action: "initialize", service: "auth" });
      setSession(null);
      setLoading(false);
    }
    return () => unsubscribe?.();
  }, []);

  return { session, user: session?.user ?? null, loading };
}