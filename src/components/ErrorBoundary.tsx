import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Static, native-safe recovery surface: never relies on Ant Design or on the
 * native runtime, so it still renders when a child crashed during render.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console trail for support without letting reporting crash the UI.
    console.error("[iptools] 界面渲染异常", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: "var(--font-ui)", color: "var(--text)" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>界面出现异常</h2>
        <p style={{ color: "var(--text-soft)", margin: "0 0 16px" }}>
          已阻止界面继续崩溃。你可以重新加载界面；如果问题持续出现，请把下面的信息反馈给我。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          重新加载界面
        </button>
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: "var(--surface-inset)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 12,
            overflow: "auto",
            maxHeight: 240,
          }}
        >
          {error.message}
          {"\n"}
          {error.stack ?? ""}
        </pre>
      </div>
    );
  }
}
