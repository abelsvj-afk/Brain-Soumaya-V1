import { Component, type ErrorInfo, type ReactNode } from "react";
import { getDiagnosticSnapshot, logDiagnosticEvent } from "../diagnostics/buffer";
import { isDiagnosticsEnabled } from "../diagnostics/config";
import { maybeReloadForChunkError } from "../lib/chunkReload";

interface Props {
  children: ReactNode;
  /**
   * Optional contained fallback. When provided, a crash in `children` renders this
   * instead of the full-screen "fatal" panel — so an isolated subtree (e.g. the 3D
   * galaxy) can fail without taking the whole app down. `null` = render nothing and
   * let the rest of the app keep working.
   */
  fallback?: ReactNode;
  /** Label for the console log, so we can tell which boundary caught it. */
  label?: string;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defense: a render/runtime error in the 3D scene should show a
 * readable message (and log to the console) instead of an unrecoverable black
 * screen over the dark background. With a `fallback`, it isolates a subtree so one
 * broken surface never freezes/blanks the entire app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[app] render error${this.props.label ? ` (${this.props.label})` : ""}:`, error, info.componentStack);
    logDiagnosticEvent('error', this.props.label || 'boundary', { message: error.message, componentStack: info.componentStack });
    // A lazy panel/chunk that no longer exists after a deploy (stale shell)
    // recovers by reloading once into the fresh shell instead of dead-ending
    // on this boundary's error UI. Guarded in chunkReload: if the fresh shell
    // still fails, this boundary's error screen shows exactly as before.
    maybeReloadForChunkError(error);
    if (isDiagnosticsEnabled()) {
      console.log("[diagnostics] Crash snapshot:", getDiagnosticSnapshot());
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      // Contained failure: render the provided fallback and keep the rest of the app alive.
      if (this.props.fallback !== undefined) {
        return (
          <>
            {this.props.fallback}
            <div style={{ position: "fixed", bottom: "10px", left: "10px", right: "10px", zIndex: 999999, background: "rgba(40,10,15,0.95)", color: "#ff8899", padding: "12px", border: "1px solid #ff4466", borderRadius: "8px", fontFamily: "monospace", fontSize: "11px", whiteSpace: "pre-wrap", maxHeight: "200px", overflow: "auto" }}>
              <strong>[GALAXY DIAGNOSTIC ERROR]</strong>: {this.state.error.message}
              {"\n"}{this.state.error.stack}
            </div>
          </>
        );
      }
      return (
        <div className="fatal">
          <h1>Something broke in the galaxy</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
