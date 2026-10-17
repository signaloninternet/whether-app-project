import { Component, type ErrorInfo, type ReactNode } from "react";

/** Last line of defence: a render error shows a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 16, background: "#f4f4f2" }}>
        <div style={{ maxWidth: 360, padding: "24px 22px", borderRadius: 16, background: "#fff", boxShadow: "var(--shadow-2)", textAlign: "center" }}>
          <strong style={{ display: "block", fontSize: 16 }}>Something went wrong</strong>
          <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--ink-2)" }}>{this.state.error.message}</p>
          <a href="/plan" style={{ color: "var(--blue-ink)", fontWeight: 600 }}>Start a new trip</a>
        </div>
      </div>
    );
  }
}
