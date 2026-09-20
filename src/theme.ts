import { theme as antdTheme, type ThemeConfig } from "antd";
import type { ThemeMode } from "./lib/types";

export type ResolvedTheme = "light" | "dark";

export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark() ? "dark" : "light";
}

/** Stamps the resolved theme on <html> so CSS tokens switch with no flash. */
export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
  }
  return resolved;
}

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => onChange();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Ant Design tokens mapped from the same semantic values as tokens.css. */
export function antdThemeConfig(resolved: ResolvedTheme): ThemeConfig {
  const dark = resolved === "dark";
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? "#4cc2d6" : "#0b7285",
      colorInfo: dark ? "#7cb6ff" : "#1f5fa8",
      colorSuccess: dark ? "#4ed6a8" : "#12715b",
      colorWarning: dark ? "#f0b642" : "#9a6700",
      colorError: dark ? "#ff7b72" : "#b42318",
      colorBgBase: dark ? "#0e1420" : "#f4f6f9",
      colorBgContainer: dark ? "#141c2a" : "#ffffff",
      colorBgElevated: dark ? "#1b2536" : "#ffffff",
      colorBorder: dark ? "#28344a" : "#d8dee8",
      colorBorderSecondary: dark ? "#1f2b40" : "#e6eaf2",
      colorText: dark ? "#e7ecf3" : "#101828",
      colorTextSecondary: dark ? "#a9b6c8" : "#475467",
      colorTextTertiary: dark ? "#71809a" : "#98a2b3",
      borderRadius: 10,
      borderRadiusSM: 6,
      borderRadiusLG: 14,
      controlHeight: 32,
      fontSize: 14,
      fontFamily:
        '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
      wireframe: false,
    },
    components: {
      Layout: {
        bodyBg: "transparent",
        headerBg: "transparent",
        siderBg: "transparent",
      },
      Table: {
        headerBg: dark ? "#1b2536" : "#eef1f6",
        rowHoverBg: dark ? "#1f2b40" : "#f7f9fc",
        borderColor: dark ? "#28344a" : "#d8dee8",
        cellPaddingBlockSM: 6,
      },
      Card: {
        colorBgContainer: dark ? "#141c2a" : "#ffffff",
      },
      Modal: {
        contentBg: dark ? "#141c2a" : "#ffffff",
        headerBg: dark ? "#141c2a" : "#ffffff",
      },
      Segmented: {
        itemSelectedBg: dark ? "#243146" : "#ffffff",
      },
    },
  };
}
