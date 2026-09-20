import { Button, Segmented, Tooltip } from "antd";
import {
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
  ReloadOutlined,
  SwitcherOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { isNative } from "../lib/api/native";
import { useAppStore } from "../state/store";
import type { ThemeMode } from "../lib/types";

const DRAG_THRESHOLD = 4;

/**
 * Frameless title bar. Dragging only starts after a small pointer movement so
 * double-click maximize/restore stays deterministic, and every window control
 * is a real button outside the drag surface.
 */
export default function TitleBar() {
  const status = useAppStore((state) => state.status);
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const refresh = useAppStore((state) => state.refreshAdapters);
  const adaptersState = useAppStore((state) => state.adaptersState);

  const [maximized, setMaximized] = useState(false);
  const dragState = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const windowHandle = useCallback(async () => {
    if (!isNative()) return null;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  }, []);

  useEffect(() => {
    if (!isNative()) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const current = await windowHandle();
      if (!current || cancelled) return;
      setMaximized(await current.isMaximized());
      unlisten = await current.onResized(async () => {
        setMaximized(await current.isMaximized());
      });
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [windowHandle]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragState.current = { x: event.screenX, y: event.screenY, active: false };
  };

  const onPointerMove = async (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.active) return;
    const moved =
      Math.abs(event.screenX - state.x) > DRAG_THRESHOLD ||
      Math.abs(event.screenY - state.y) > DRAG_THRESHOLD;
    if (!moved) return;
    state.active = true;
    const current = await windowHandle();
    await current?.startDragging();
  };

  const endDrag = () => {
    dragState.current = null;
  };

  const toggleMaximize = async () => {
    const current = await windowHandle();
    if (!current) return;
    await current.toggleMaximize();
    setMaximized(await current.isMaximized());
  };

  const minimize = async () => {
    const current = await windowHandle();
    await current?.minimize();
  };

  const closeWindow = async () => {
    const current = await windowHandle();
    await current?.close();
  };

  return (
    <header className="titlebar">
      <div
        className="titlebar__drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={toggleMaximize}
      >
        <span className="titlebar__title">IP 地址修改器</span>
        <span className="titlebar__badge">v{status?.version ?? "…"}</span>
        {status?.isElevated ? (
          <span className="titlebar__badge" title="已获得管理员权限">
            管理员
          </span>
        ) : null}
      </div>

      <div className="titlebar__actions">
        <Segmented
          size="small"
          value={themeMode}
          aria-label="主题模式"
          onChange={(value) => void setThemeMode(value as ThemeMode)}
          options={[
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
            { value: "system", label: "跟随系统" },
          ]}
        />
        <Tooltip title="刷新网卡列表">
          <Button
            size="small"
            type="text"
            aria-label="刷新网卡列表"
            loading={adaptersState === "loading"}
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
          />
        </Tooltip>
      </div>

      <div className="titlebar__controls">
        <button type="button" className="winbtn" aria-label="最小化" title="最小化" onClick={minimize}>
          <MinusOutlined />
        </button>
        <button
          type="button"
          className="winbtn"
          aria-label={maximized ? "还原窗口" : "最大化"}
          title={maximized ? "还原窗口" : "最大化"}
          onClick={toggleMaximize}
        >
          {maximized ? <SwitcherOutlined /> : <BorderOutlined />}
        </button>
        <button
          type="button"
          className="winbtn winbtn--close"
          aria-label="关闭"
          title="关闭"
          onClick={closeWindow}
        >
          <CloseOutlined />
        </button>
      </div>
    </header>
  );
}
