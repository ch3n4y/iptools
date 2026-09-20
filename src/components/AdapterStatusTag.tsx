import { Tag, Tooltip } from "antd";
import { STATUS_LABEL } from "../lib/format";
import type { AdapterInfo, AdapterStatus } from "../lib/types";

const COLOR: Record<AdapterStatus, string> = {
  connected: "green",
  disconnected: "default",
  disabled: "orange",
  faulty: "red",
  unknown: "blue",
};

const ICON: Record<AdapterStatus, string> = {
  connected: "●",
  disconnected: "○",
  disabled: "⨯",
  faulty: "▲",
  unknown: "?",
};

const HINT: Record<AdapterStatus, string> = {
  connected: "网卡已连接，可正常通信",
  disconnected: "网卡已启用但未连接（网线未插或未关联无线网络）",
  disabled: "网卡被禁用，需先启用才能配置",
  faulty: "设备状态异常（驱动或硬件报告为不可用）",
  unknown: "无法确定网卡状态",
};

export default function AdapterStatusTag({ adapter }: { adapter: AdapterInfo }) {
  const status = adapter.status;
  return (
    <Tooltip title={HINT[status]}>
      <Tag color={COLOR[status]} style={{ marginInlineEnd: 0 }}>
        {ICON[status]} {STATUS_LABEL[status]}
      </Tag>
    </Tooltip>
  );
}
