import { Component, type ErrorInfo, type ReactNode } from "react";
import { logAppError, notifyRecoverableError } from "@/lib/error-logger";

type Props = {
  children: ReactNode;
  name?: string;
  resetKey?: string;
};

type State = {
  hasError: boolean;
  errorId?: string;
};

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const entry = logAppError(error, {
      component: this.props.name ?? "GlobalErrorBoundary",
      action: "render",
      metadata: { componentStack: info.componentStack },
    });
    notifyRecoverableError("A section recovered without closing the platform.");
    this.setState({ errorId: entry.id });
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorId: undefined });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="card-premium p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Section recovered safely</p>
          <p className="mt-1">This workspace stayed online while the failed section was isolated.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorId: undefined })}
            className="mt-3 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary/40"
          >
            Restore section
          </button>
        </div>
      </div>
    );
  }
}