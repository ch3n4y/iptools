import { Button, Space, Typography } from "antd";
import { SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { errorSummary, type AppError } from "../../lib/errors";
import { formatTimestamp } from "../../lib/format";
import type { AdapterBackup } from "../../lib/types";

interface Props {
  backup: AdapterBackup | null;
  backupAt: number | null;
  backupError: AppError | null;
  disabled: boolean;
  onCapture: () => void;
  onRestore: () => void;
}

function describeBackup(backup: AdapterBackup): string {
  const address =
    backup.addresses.length > 0
      ? backup.addresses.map((entry) => `${entry.address}/${entry.prefix}`).join("、")
      : "无 IP 地址";
  const dns = backup.dns.length > 0 ? backup.dns.join("、") : "无 DNS";
  return `${backup.dhcp ? "自动获取（DHCP）" : "手动设置"} · ${address} · 网关 ${backup.gateway ?? "无"} · DNS ${dns}`;
}

/**
 * 底部的备份/恢复条：两个按钮 + 一行状态。
 * 「应用配置」前会自动备份，这里的「备份当前配置」用于手动留一份快照。
 */
export default function BackupBar({
  backup,
  backupAt,
  backupError,
  disabled,
  onCapture,
  onRestore,
}: Props) {
  return (
    <Space direction="vertical" size={4} style={{ width: "100%", marginTop: 4 }}>
      <Space size={8} wrap>
        <Button icon={<SaveOutlined />} disabled={disabled} onClick={onCapture}>
          备份当前配置
        </Button>
        <Button icon={<UndoOutlined />} disabled={disabled || !backup} onClick={onRestore}>
          恢复备份
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: "var(--fs-xs)" }}>
          {backup
            ? `已备份：${backup.adapterName} · ${formatTimestamp(backupAt ?? 0)}`
            : "尚未保存备份快照（每次「应用配置」前会自动备份）"}
        </Typography.Text>
      </Space>
      {backup ? (
        <Typography.Text type="secondary" className="mono" style={{ fontSize: "var(--fs-xs)" }}>
          {describeBackup(backup)}
        </Typography.Text>
      ) : null}
      {backupError ? (
        <Typography.Text type="warning" style={{ fontSize: "var(--fs-xs)" }}>
          上次备份未成功：{errorSummary(backupError)}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
