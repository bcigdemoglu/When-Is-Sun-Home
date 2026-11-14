"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** What to show instead. `reset` re-mounts the children. */
  fallback(error: unknown, reset: () => void): ReactNode;
  onError?(error: unknown, info: ErrorInfo): void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  error: unknown;
}

/** Catches render-time errors below it so one broken part cannot blank the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ failed: false, error: null });
  };

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
