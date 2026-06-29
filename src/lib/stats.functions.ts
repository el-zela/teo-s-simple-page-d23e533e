import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPublicStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [usersRes, tradesRes, signalsRes, leaderRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("trades").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("signals").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("trades")
      .select("user_id, pnl_realized")
      .order("pnl_realized", { ascending: false })
      .limit(200),
  ]);

  const agg = new Map<string, { pnl: number; trades: number }>();
  for (const t of leaderRes.data ?? []) {
    const cur = agg.get(t.user_id) ?? { pnl: 0, trades: 0 };
    cur.pnl += Number(t.pnl_realized ?? 0);
    cur.trades += 1;
    agg.set(t.user_id, cur);
  }
  const leaderboard = [...agg.entries()]
    .map(([user_id, v]) => ({ user_id, ...v }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 5);

  return {
    users: usersRes.count ?? 0,
    trades: tradesRes.count ?? 0,
    signals: signalsRes.count ?? 0,
    leaderboard,
  };
});

export const getAccountStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [openRes, closedRes, allRes] = await Promise.all([
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("trades").select("pnl_realized").eq("user_id", userId),
    ]);
    const totalPnl = (allRes.data ?? []).reduce((a, t) => a + Number(t.pnl_realized ?? 0), 0);
    return {
      open: openRes.count ?? 0,
      closed: closedRes.count ?? 0,
      total_trades: (allRes.data ?? []).length,
      total_pnl: totalPnl,
    };
  });