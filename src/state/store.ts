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

export type ViewKey =
  | "home"
  | "identity"
  | "schemes"
  | "advanced"
  | "ping"
  | "subnet"
  | "settings"
  | "help";

export const VIEW_META: Record<
  ViewKey,
  { label: string; group: string; hotkey?: string; desc: string }
> = {
  home: {
    label: "主界面",
    group: "网卡",
    hotkey: "F2",
    desc: "查看并修改当前网卡的 IP / 掩码 / 网关 / DNS",
  },
  identity: {
    label: "主机与 MAC",
    group: "网卡",
    desc: "计算机名、工作组与网卡 MAC 地址",
  },
  schemes: {
    label: "方案管理",
    group: "配置",
    hotkey: "F6",
    desc: "保存、导入与一键应用常用网络方案",
  },
  advanced: {
    label: "高级选项",
    group: "配置",
    desc: "单网卡多 IP、自动网关与子网类掩码",
  },
  ping: {
    label: "C 网群 Ping 器",
    group: "工具箱",
    hotkey: "F8",
    desc: "ARP / ICMP 批量扫描与结果导出",
  },
  subnet: {
    label: "子网掩码计算器",
    group: "工具箱",
    desc: "掩码、反掩码、网络与主机范围计算",
  },
  settings: {
    label: "设置",
    group: "应用",
    desc: "主题、刷新频率、配置位置与自动更新",
  },
  help: {
    label: "帮助",
    group: "应用",
    hotkey: "F1",
    desc: "快捷键与常见问题说明",
  },
};

export const NAV_GROUPS: Array<{ group: string; items: ViewKey[] }> = [
  { group: "网卡", items: ["home", "identity"] },
  { group: "配置", items: ["schemes", "advanced"] },
  { group: "工具箱", items: ["ping", "subnet"] },
  { group: "应用", items: ["settings", "help"] },
];

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

  bootstrap: () => Promise<void>;
  refreshAdapters: (options?: { silent?: boolean }) => Promise<void>;
  refreshAdapter: (adapterId: string) => Promise<AdapterInfo | null>;
  selectAdapter: (adapterId: string) => void;
  setView: (view: ViewKey) => void;
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

/** Custom DOM event used by the F6 shortcut to reach the schemes view. */
export const APPLY_SELECTED_SCHEME_EVENT = "iptools:apply-selected-scheme";
