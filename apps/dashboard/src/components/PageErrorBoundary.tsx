import { Component, type ErrorInfo, type ReactNode } from "react";

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Dashboard page failed", error, info.componentStack); }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="border border-line-strong bg-surface-subtle p-6">
      <h1 className="text-lg font-semibold">This page could not be displayed</h1>
      <p className="mt-2 text-sm text-secondary">Try again, or use the navigation to open another page.</p>
      <button className="mt-4 border border-line-strong bg-surface px-4 py-2 text-sm" onClick={() => this.setState({ failed: false })}>Try again</button>
    </div>;
  }
}
