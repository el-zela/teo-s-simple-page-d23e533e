import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Returns user's redeemed signal IDs + next free signal availability. */
export const getRedemptionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("signal_redemptions")
      .select("signal_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const last = rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0;
    const nextAvailableAt = last ? last + COOLDOWN_MS : 0;
    return {
      redeemedIds: rows.map((r) => r.signal_id as string),
      nextAvailableAt,
      now: Date.now(),
    };
  });

/** Redeem a specific signal. Enforces 24h cooldown per user. */
export const redeemSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ signal_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Already redeemed?
    const { data: existing } = await supabase
      .from("signal_redemptions")
      .select("id")
      .eq("user_id", userId)
      .eq("signal_id", data.signal_id)
      .maybeSingle();
    if (existing) return { ok: true as const, alreadyRedeemed: true };

    // Cooldown check
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { data: recent, error: rErr } = await supabase
      .from("signal_redemptions")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (rErr) throw new Error(rErr.message);
    if (recent && recent.length > 0) {
      const nextAt = new Date(recent[0].created_at).getTime() + COOLDOWN_MS;
      return { ok: false as const, error: "cooldown", nextAvailableAt: nextAt };
    }

    const { error: iErr } = await supabase
      .from("signal_redemptions")
      .insert({ user_id: userId, signal_id: data.signal_id });
    if (iErr) return { ok: false as const, error: iErr.message };
    return { ok: true as const, alreadyRedeemed: false };
  });
