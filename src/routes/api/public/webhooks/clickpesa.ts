import { createFileRoute } from "@tanstack/react-router";

// ClickPesa webhook endpoint. Configure this URL inside the ClickPesa dashboard:
//   https://project--0aadccaa-f3a4-4f65-a213-ddf1d0e2dd51.lovable.app/api/public/webhooks/clickpesa
// Acknowledges with 2xx after recording the event and crediting the user's Main wallet
// on successful payment.

type ClickPesaEvent = {
  event?: string;
  status?: string;
  orderReference?: string;
  id?: string;
  amount?: string | number;
  currency?: string;
  // ClickPesa nests payload in `data` for some events
  data?: ClickPesaEvent;
};

function extractPayload(body: ClickPesaEvent): ClickPesaEvent {
  // Some events wrap fields inside `data`
  return body.data ? { ...body, ...body.data } : body;
}

function isSuccess(status?: string): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === "SUCCESS" || s === "SUCCESSFUL" || s === "PAYMENT RECEIVED" || s === "COMPLETED" || s === "SETTLED";
}

export const Route = createFileRoute("/api/public/webhooks/clickpesa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: ClickPesaEvent;
        try {
          body = (await request.json()) as ClickPesaEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const payload = extractPayload(body);
        const orderRef = payload.orderReference;
        if (!orderRef) {
          // Nothing we can correlate to — still 200 so ClickPesa doesn't retry forever
          return new Response("ok", { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Look up our deposit record
        const { data: deposit } = await supabaseAdmin
          .from("deposits")
          .select("id, user_id, amount_usd, status, credited_at")
          .eq("order_reference", orderRef)
          .maybeSingle();

        if (!deposit) {
          return new Response("ok", { status: 200 });
        }

        const newStatus = (payload.status ?? "").toUpperCase() || deposit.status;

        // Always log latest payload + status
        await supabaseAdmin
          .from("deposits")
          .update({
            status: newStatus,
            clickpesa_payment_id: payload.id ?? null,
            raw_webhook: body as never,
          })
          .eq("id", deposit.id);

        // Credit Main wallet once on success
        if (isSuccess(payload.status) && !deposit.credited_at) {
          // Ensure a Main wallet exists
          let walletId: string | null = null;
          const { data: existing } = await supabaseAdmin
            .from("wallets")
            .select("id")
            .eq("user_id", deposit.user_id)
            .eq("type", "main")
            .maybeSingle();
          if (existing) {
            walletId = existing.id;
          } else {
            const { data: created, error: wErr } = await supabaseAdmin
              .from("wallets")
              .insert({ user_id: deposit.user_id, type: "main", balance: 0, currency: "USD" })
              .select("id")
              .single();
            if (wErr) return new Response("ok", { status: 200 });
            walletId = created.id;
          }

          // Insert credit ledger entry (trigger updates balance)
          await supabaseAdmin.from("ledger_entries").insert({
            user_id: deposit.user_id,
            wallet_id: walletId!,
            ref_type: "deposit",
            ref_id: `clickpesa-${orderRef}`,
            direction: "credit",
            amount: Number(deposit.amount_usd),
            currency: "USD",
            memo: `ClickPesa deposit ${orderRef}`,
          });

          await supabaseAdmin
            .from("deposits")
            .update({ credited_at: new Date().toISOString(), status: "SUCCESS" })
            .eq("id", deposit.id);
        }

        return new Response("ok", { status: 200 });
      },

      // Some providers probe with GET — respond OK
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
