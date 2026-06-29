import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Msg = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) });
const Input = z.object({
  messages: z.array(Msg).min(1).max(30),
});

export const chatWithAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false as const, error: "ai_unavailable" };
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are TeoForex AI Assistant — a helpful, concise trading & app support assistant for the TeoForex AI signals fintech app. Help users understand forex trading (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD), wallets (main/trading/reward/affiliate), AI signals, deposits/withdrawals, and account features. Keep answers short and actionable. Reply in the user's language (English or Swahili).",
            },
            ...data.messages,
          ],
        }),
      });
      if (!res.ok) {
        if (res.status === 429) return { ok: false as const, error: "rate_limited" };
        if (res.status === 402) return { ok: false as const, error: "credits_exhausted" };
        return { ok: false as const, error: `ai_error_${res.status}` };
      }
      const json = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "";
      return { ok: true as const, content };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "ai_error" };
    }
  });
