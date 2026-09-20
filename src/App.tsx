import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import AppShell from "./components/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAppStore } from "./state/store";
import { antdThemeConfig, watchSystemTheme } from "./theme";

export default function App() {
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const themeMode = useAppStore((state) => state.themeMode);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // "system" mode follows the OS without a reload, and without a scheme flash.
  useEffect(() => {
    if (themeMode !== "system") return undefined;
    return watchSystemTheme(() => {
      void useAppStore.getState().setThemeMode("system");
    });
  }, [themeMode]);

  // Reconcile when the window becomes visible again (the user may have changed
  // network settings outside the app).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAdapters({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAdapters]);

  return (
    <ConfigProvider theme={antdThemeConfig(resolvedTheme)} locale={zhCN}>
      <AntApp>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  );
}
