import { toast } from "sonner";

export type ErrorLogContext = {
  component?: string;
  action?: string;
  service?: string;
  metadata?: Record<string, unknown>;
};

export type AppErrorLogEntry = {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  component: string;
  action?: string;
  service?: string;
  metadata?: Record<string, unknown>;
};

declare global {
  interface Window {
    __nexusErrorLog?: AppErrorLogEntry[];
  }
}

let globalHandlersReady = false;
let lastToastAt = 0;

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message || "Unknown error", stack: error.stack };
  }
  if (typeof error === "string") return { message: error, stack: undefined };
  try {
    return { message: JSON.stringify(error), stack: undefined };
  } catch {
    return { message: "Unknown error", stack: undefined };
  }
}

export function logAppError(error: unknown, context: ErrorLogContext = {}): AppErrorLogEntry {
  const normalized = normalizeError(error);
  const entry: AppErrorLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    message: normalized.message,
    stack: normalized.stack,
    component: context.component ?? "unknown",
    action: context.action,
    service: context.service,
    metadata: context.metadata,
  };

  if (typeof window !== "undefined") {
    window.__nexusErrorLog = [entry, ...(window.__nexusErrorLog ?? [])].slice(0, 100);
  }

  console.error("[nexus-error]", entry);
  return entry;
}

export function notifyRecoverableError(message = "Temporary issue recovered automatically.") {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastToastAt < 3500) return;
  lastToastAt = now;
  toast.error(message, { duration: 3000 });
}

export function setupGlobalErrorLogging() {
  if (typeof window === "undefined" || globalHandlersReady) return;
  globalHandlersReady = true;

  window.addEventListener("error", (event) => {
    logAppError(event.error ?? event.message, {
      component: "window",
      action: "error",
      metadata: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
    notifyRecoverableError("Market workspace recovered from a temporary issue.");
  });

  window.addEventListener("unhandledrejection", (event) => {
    logAppError(event.reason, { component: "window", action: "unhandledrejection" });
    notifyRecoverableError("Background request failed safely. Retrying when possible.");
  });
}