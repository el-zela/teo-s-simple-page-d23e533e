import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WALLET_TYPES = ["main", "trading", "reward", "affiliate"] as const;

const DepositInput = z.object({
  wallet_type: z.enum(WALLET_TYPES),
  amount: z.number().positive().max(1_000_000),
  idempotency_key: z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/),
});

const WithdrawInput = DepositInput;

const TransferInput = z.object({
  from_type: z.enum(WALLET_TYPES),
  to_type: z.enum(WALLET_TYPES),
  amount: z.number().positive().max(1_000_000),
  idempotency_key: z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/),
});

type WalletType = (typeof WALLET_TYPES)[number];
async function ensureWallet(userId: string, type: WalletType) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("id,balance")
    .eq("user_id", userId)
    .eq("type", type)
    .maybeSingle();
  if (data) return data as { id: string; balance: number };
  const { data: created, error } = await supabaseAdmin
    .from("wallets")
    .insert({ user_id: userId, type, balance: 0, currency: "USD" })
    .select("id,balance")
    .single();
  if (error) throw new Error(error.message);
  return created as { id: string; balance: number };
}

export const depositFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DepositInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const wallet = await ensureWallet(userId, data.wallet_type);
    const { error } = await supabaseAdmin.from("ledger_entries").insert({
      user_id: userId,
      wallet_id: wallet.id,
      ref_type: "deposit",
      ref_id: data.idempotency_key,
      direction: "credit",
      amount: data.amount,
      currency: "USD",
      memo: `Deposit to ${data.wallet_type} wallet`,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, amount: data.amount, wallet_type: data.wallet_type };
  });

export const withdrawFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WithdrawInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const wallet = await ensureWallet(userId, data.wallet_type);
    if (Number(wallet.balance) < data.amount) {
      return { ok: false as const, error: "insufficient_funds" };
    }
    const { error } = await supabaseAdmin.from("ledger_entries").insert({
      user_id: userId,
      wallet_id: wallet.id,
      ref_type: "withdrawal",
      ref_id: data.idempotency_key,
      direction: "debit",
      amount: data.amount,
      currency: "USD",
      memo: `Withdraw from ${data.wallet_type} wallet`,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, amount: data.amount, wallet_type: data.wallet_type };
  });

export const transferFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TransferInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.from_type === data.to_type) return { ok: false as const, error: "same_wallet" };
    const from = await ensureWallet(userId, data.from_type);
    if (Number(from.balance) < data.amount) return { ok: false as const, error: "insufficient_funds" };
    const to = await ensureWallet(userId, data.to_type);
    const { error: e1 } = await supabaseAdmin.from("ledger_entries").insert({
      user_id: userId,
      wallet_id: from.id,
      ref_type: "transfer_out",
      ref_id: `${data.idempotency_key}-out`,
      direction: "debit",
      amount: data.amount,
      currency: "USD",
      memo: `Transfer to ${data.to_type}`,
    });
    if (e1) return { ok: false as const, error: e1.message };
    const { error: e2 } = await supabaseAdmin.from("ledger_entries").insert({
      user_id: userId,
      wallet_id: to.id,
      ref_type: "transfer_in",
      ref_id: `${data.idempotency_key}-in`,
      direction: "credit",
      amount: data.amount,
      currency: "USD",
      memo: `Transfer from ${data.from_type}`,
    });
    if (e2) return { ok: false as const, error: e2.message };
    return { ok: true as const };
  });
