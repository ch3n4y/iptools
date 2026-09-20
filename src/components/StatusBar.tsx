import { Tooltip } from "antd";
import { system as systemApi } from "../lib/api";
import { isNative } from "../lib/api/native";
import { formatSpeed, STATUS_LABEL } from "../lib/format";
import { useAppStore, currentAdapter, VIEW_META } from "../state/store";

/** Bottom strip: live counts, the current selection and the shortcut reminder. */
export default function StatusBar() {
  const adapters = useAppStore((state) => state.adapters);
  const view = useAppStore((state) => state.view);
  const status = useAppStore((state) => state.status);
  const selected = useAppStore(currentAdapter);

  const connected = adapters.filter((adapter) => adapter.status === "connected").length;
  const up = adapters.filter((adapter) => adapter.enabled).length;

  return (
    <footer className="statusbar" role="contentinfo">
      <span>
        网卡 {adapters.length} 个（已启用 {up} / 已连接 {connected}）
      </span>
      {selected ? (
        <span>
          当前：{selected.name} · {STATUS_LABEL[selected.status]} · {formatSpeed(selected.linkSpeedBps)}
        </span>
      ) : (
        <span>未选择网卡</span>
      )}
      <span className="statusbar__spacer" />
      <span>{VIEW_META[view].label}</span>
      <Tooltip title={status?.configDir ?? "配置目录"}>
        <button
          type="button"
          className="statusbar__link"
          onClick={() => {
            if (!isNative()) return;
            void systemApi.openAppLocation();
          }}
        >
          配置目录
        </button>
      </Tooltip>
      <Tooltip title={status?.osDescription ?? ""}>
        <span>v{status?.version ?? "…"}</span>
      </Tooltip>

    </footer>
  );
}
