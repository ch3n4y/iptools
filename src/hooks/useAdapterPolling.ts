import { useEffect } from "react";
import { useAppStore } from "../state/store";

/** Silently re-reads the adapter list on the interval from settings. */
export function useAdapterPolling() {
  const autoRefresh = useAppStore((state) => state.settings?.autoRefreshAdapters ?? false);
  const interval = useAppStore((state) => state.settings?.refreshIntervalMs ?? 8000);
  const refresh = useAppStore((state) => state.refreshAdapters);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      // Skip polling while the document is hidden — the native call is real work.
      if (document.visibilityState === "hidden") return;
      void refresh({ silent: true });
    }, Math.max(2000, interval));
    return () => window.clearInterval(timer);
  }, [autoRefresh, interval, refresh]);
}
