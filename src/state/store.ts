import { create } from "zustand";
import {
  adapters as adaptersApi,
  app as appApi,
  schemes as schemesApi,
  settings as settingsApi,
  system as systemApi,
} from "../lib/api";
import { AppError, toAppError } from "../lib/errors";
import { applyThemeMode, type ResolvedTheme } from "../theme";
import type {
  AdapterInfo,
  AppSettings,
  AppStatus,
  IdentityInfo,
  Scheme,
  ThemeMode,
} from "../lib/types";

export type ViewKey = "home" | "schemes" | "toolbox" | "settings" | "help";

/** 工具箱内的两个工具页：网络扫描 / 掩码计算。 */
export type ToolboxTool = "scan" | "mask";

export const VIEW_META: Record<ViewKey, { label: string; desc: string }> = {
  home: {
    label: "网卡配置",
    desc: "选择网卡、查看当前配置，并修改 IP / 掩码 / 网关 / DNS / 跃点数与 MAC",
  },
  schemes: {
    label: "方案管理",
    desc: "把常用网络配置保存为方案，双击即可一键应用，支持 CSV / Excel / JSON 导入导出",
  },
  toolbox: {
    label: "工具箱",
    desc: "批量扫描在线主机与 MAC 地址，以及子网掩码、主机范围计算",
  },
  settings: {
    label: "偏好设置",
    desc: "主题、刷新频率、应用前确认、配置位置与自动更新",
  },
  help: {
    label: "使用帮助",
    desc: "使用流程、功能说明与常见问题",
  },
};

/** Left-rail order (single flat list keeps navigation predictable). */
export const VIEW_ORDER: ViewKey[] = ["home", "schemes", "toolbox", "settings", "help"];
export interface AppState {
  ready: boolean;
  status: AppStatus | null;
  statusError: AppError | null;
  settings: AppSettings | null;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  adapters: AdapterInfo[];
  adaptersState: "loading" | "ready" | "error";
  adaptersError: AppError | null;
  lastRefreshedAt: number;
  selectedAdapterId: string | null;
  identity: IdentityInfo | null;
  identityError: AppError | null;
  schemes: Scheme[];
  schemesLoading: boolean;
  view: ViewKey;
  /** 工具箱内的当前工具页（网络扫描 / 掩码计算）。 */
  toolboxTool: ToolboxTool;
  /** 掩码计算页交给扫描页的网段；扫描页消费一次后置空，避免重复覆盖用户输入。 */
  pendingScanSpec: string | null;

  bootstrap: () => Promise<void>;
  refreshAdapters: (options?: { silent?: boolean }) => Promise<void>;
  refreshAdapter: (adapterId: string) => Promise<AdapterInfo | null>;
  selectAdapter: (adapterId: string) => void;
  setView: (view: ViewKey) => void;
  setToolboxTool: (tool: ToolboxTool) => void;
  setPendingScanSpec: (spec: string | null) => void;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  refreshSchemes: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}

const STORAGE_KEY = "iptools.theme";

function storedThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* localStorage may be unavailable; fall through */
  }
  return "system";
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  status: null,
  statusError: null,
  settings: null,
  themeMode: storedThemeMode(),
  resolvedTheme: applyThemeMode(storedThemeMode()),
  adapters: [],
  adaptersState: "loading",
  adaptersError: null,
  lastRefreshedAt: 0,
  selectedAdapterId: null,
  identity: null,
  identityError: null,
  schemes: [],
  schemesLoading: false,
  view: "home",
  toolboxTool: "scan",
  pendingScanSpec: null,

  async bootstrap() {
    try {
      const [status, settings] = await Promise.all([
        appApi.appStatus(),
        settingsApi.getSettings(),
      ]);
      const mode = settings.theme ?? get().themeMode;
      set({
        status,
        settings,
        themeMode: mode,
        resolvedTheme: applyThemeMode(mode),
        ready: true,
      });
      await get().refreshAdapters();
      const list = get().adapters;
      const preferred = get().selectedAdapterId ?? settings.lastAdapterId;
      const chosen =
        list.find((adapter) => adapter.id === preferred)?.id ??
        list.find(
          (adapter) =>
            adapter.enabled && adapter.status === "connected" && !adapter.isVirtual,
        )?.id ??
        list[0]?.id ??
        null;
      if (chosen) set({ selectedAdapterId: chosen });
      void get().refreshSchemes();
      void get().refreshIdentity();
    } catch (error) {
      set({ statusError: toAppError(error), ready: true, adaptersState: "error" });
    }
  },

  async refreshAdapters(options) {
    if (!options?.silent) set({ adaptersState: "loading" });
    try {
      const list = await adaptersApi.listAdapters();
      set({
        adapters: list,
        adaptersState: "ready",
        adaptersError: null,
        lastRefreshedAt: Date.now(),
      });
      const selected = get().selectedAdapterId;
      if (!selected || !list.some((adapter) => adapter.id === selected)) {
        const fallback =
          list.find(
            (adapter) =>
              adapter.enabled && adapter.status === "connected" && !adapter.isVirtual,
          ) ?? list[0];
        set({ selectedAdapterId: fallback?.id ?? null });
      }
    } catch (error) {
      const appError = toAppError(error);
      set(
        options?.silent
          ? { adaptersError: appError }
          : { adaptersState: "error", adaptersError: appError },
      );
    }
  },

  async refreshAdapter(adapterId) {
    try {
      const adapter = await adaptersApi.getAdapter(adapterId);
      set((state) => ({
        adapters: state.adapters.map((item) => (item.id === adapter.id ? adapter : item)),
      }));
      return adapter;
    } catch {
      return null;
    }
  },

  selectAdapter(adapterId) {
    set({ selectedAdapterId: adapterId });
    if (get().settings) {
      void get().patchSettings({ lastAdapterId: adapterId });
    }
  },

  setView(view) {
    set({ view });
  },

  setToolboxTool(toolboxTool) {
    set({ toolboxTool });
  },

  setPendingScanSpec(pendingScanSpec) {
    set({ pendingScanSpec });
  },

  async patchSettings(patch) {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      const saved = await settingsApi.saveSettings(next);
      set({ settings: saved });
      if (patch.theme) {
        set({ themeMode: saved.theme, resolvedTheme: applyThemeMode(saved.theme) });
      }
    } catch {
      /* keep the optimistic value; the next bootstrap re-reads from disk */
    }
  },

  async setThemeMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ themeMode: mode, resolvedTheme: applyThemeMode(mode) });
    await get().patchSettings({ theme: mode });
  },

  async refreshSchemes() {
    set({ schemesLoading: true });
    try {
      const list = await schemesApi.listSchemes(get().selectedAdapterId);
      set({ schemes: list, schemesLoading: false });
    } catch {
      set({ schemesLoading: false });
    }
  },

  async refreshIdentity() {
    try {
      const identity = await systemApi.getIdentity();
      set({ identity, identityError: null });
    } catch (error) {
      set({ identityError: toAppError(error) });
    }
  },
}));

export function currentAdapter(state: AppState): AdapterInfo | null {
  if (!state.selectedAdapterId) return null;
  return state.adapters.find((adapter) => adapter.id === state.selectedAdapterId) ?? null;
}


