import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { chatWithAssistant } from "@/lib/chat.functions";
import { useTranslation } from "react-i18next";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatbotWidget() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: t("chat.greeting") },
  ]);
  const ask = useServerFn(chatWithAssistant);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await ask({ data: { messages: next.slice(-12) } });
      if (res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.content || "..." }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `${t("chat.errorPrefix")} (${res.error}).` },
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e instanceof Error ? e.message : "Network error" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          aria-label={t("chat.openChat")}
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg glow hover:scale-105 transition"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-24 right-4 z-50 flex h-[70vh] max-h-[520px] w-[90vw] max-w-sm flex-col rounded-2xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{t("chat.title")}</p>
              <p className="text-xs text-muted-foreground">{t("common.online")}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label={t("chat.closeChat")} className="rounded-full p-1 hover:bg-secondary/40">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-secondary/50 text-foreground"
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="mr-auto inline-flex items-center gap-2 rounded-2xl bg-secondary/50 px-3 py-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("common.thinking")}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder={t("chat.placeholder")}
              className="flex-1 rounded-xl border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
              aria-label={t("chat.send")}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
