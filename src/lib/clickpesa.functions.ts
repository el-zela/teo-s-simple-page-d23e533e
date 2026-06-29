import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MIN_DEPOSIT_TZS,
  USD_TZS_RATE,
  detectChannel,
  normalizeTzPhone,
  tzsToUsd,
} from "./clickpesa";

const CLICKPESA_BASE = "https://api.clickpesa.com";

const InitiateInput = z.object({
  payer_name: z.string().trim().min(2).max(80),
  phone_number: z.string().trim().min(7).max(20),
  amount_tzs: z.number().int().positive().max(50_000_000),
});

async function getClickPesaToken(): Promise<string> {
  const clientId = process.env.CLICKPESA_CLIENT_ID;
  const apiKey = process.env.CLICKPESA_API_KEY;
  if (!clientId || !apiKey) throw new Error("ClickPesa credentials missing");
  const res = await fetch(`${CLICKPESA_BASE}/third-parties/generate-token`, {
    method: "POST",
    headers: { "client-id": clientId, "api-key": apiKey },
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; success?: boolean; message?: string };
  if (!res.ok || !json.token) {
    throw new Error(`ClickPesa auth failed: ${res.status} ${json.message ?? ""}`);
  }
  // Token usually arrives as "Bearer xxx" — strip prefix to normalize
  return json.token.replace(/^Bearer\s+/i, "");
}

export const initiateDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InitiateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    if (data.amount_tzs < MIN_DEPOSIT_TZS) {
      return { ok: false as const, error: `min_amount_${MIN_DEPOSIT_TZS}` };
    }
    const phone = normalizeTzPhone(data.phone_number);
    if (!phone) return { ok: false as const, error: "invalid_phone" };
    const channel = detectChannel(phone);
    if (channel === "UNKNOWN") return { ok: false as const, error: "unsupported_network" };

    const amountUsd = tzsToUsd(data.amount_tzs);
    const orderReference = `TEO${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Record the order up-front (status PENDING)
    const { error: insertErr } = await supabaseAdmin.from("deposits").insert({
      user_id: userId,
      order_reference: orderReference,
      payer_name: data.payer_name,
      phone_number: phone,
      amount_tzs: data.amount_tzs,
      amount_usd: amountUsd,
      fx_rate: USD_TZS_RATE,
      channel,
      status: "PENDING",
    });
    if (insertErr) return { ok: false as const, error: insertErr.message };

    // Auth + initiate USSD push
    let token: string;
    try {
      token = await getClickPesaToken();
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "auth_failed" };
    }

    const initRes = await fetch(`${CLICKPESA_BASE}/third-parties/payments/initiate-ussd-push-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: String(data.amount_tzs),
        currency: "TZS",
        orderReference,
        phoneNumber: phone,
      }),
    });
    const initJson = (await initRes.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      message?: string;
      error?: string;
    };

    if (!initRes.ok) {
      await supabaseAdmin
        .from("deposits")
        .update({ status: "FAILED", raw_webhook: initJson as never })
        .eq("order_reference", orderReference);
      return {
        ok: false as const,
        error: initJson.message || initJson.error || `clickpesa_${initRes.status}`,
      };
    }

    if (initJson.id) {
      await supabaseAdmin
        .from("deposits")
        .update({ clickpesa_payment_id: initJson.id, status: initJson.status ?? "PROCESSING" })
        .eq("order_reference", orderReference);
    }

    return {
      ok: true as const,
      order_reference: orderReference,
      channel,
      amount_tzs: data.amount_tzs,
      amount_usd: amountUsd,
    };
  });

const StatusInput = z.object({ order_reference: z.string().min(4).max(64) });

export const checkDepositStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("deposits")
      .select("status, amount_usd, credited_at, user_id")
      .eq("order_reference", data.order_reference)
      .maybeSingle();
    if (!row || row.user_id !== context.userId) return { ok: false as const, error: "not_found" };
    return { ok: true as const, status: row.status, amount_usd: row.amount_usd, credited_at: row.credited_at };
  });
