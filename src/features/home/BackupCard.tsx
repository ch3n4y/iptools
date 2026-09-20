import { Button, Space, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import SectionCard from "../../components/SectionCard";
import { errorSummary, type AppError } from "../../lib/errors";
import { formatTimestamp } from "../../lib/format";
import type { AdapterBackup } from "../../lib/types";

interface Props {
  backup: AdapterBackup | null;
  backupAt: number | null;
  backupError: AppError | null;
  disabled: boolean;
  onRestore: () => void;
}

function describeBackup(backup: AdapterBackup): string {
  const address =
    backup.addresses.length > 0
      ? backup.addresses.map((entry) => `${entry.address}/${entry.prefix}`).join("、")
      : "无 IP 地址";
  const gateway = backup.gateway ?? "无网关";
  const dns = backup.dns.length > 0 ? backup.dns.join("、") : "无 DNS";
  return `${backup.dhcp ? "自动获取（DHCP）" : "手动设置"} · ${address} · 网关 ${gateway} · DNS ${dns}`;
}

/** Safety net: the snapshot captured immediately before a write. */
export default function BackupCard({
  backup,
  backupAt,
  backupError,
  disabled,
  onRestore,
}: Props) {
  return (
    <SectionCard
      title="备份与恢复"
      hint="应用前自动保存修改前的配置快照"
      extra={
        <Button
          icon={<UndoOutlined />}
          disabled={disabled || !backup}
          onClick={onRestore}
        >
          恢复备份
        </Button>
      }
    >
      {backup ? (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text role="status">
            已备份修改前配置：{backup.adapterName} · {formatTimestamp(backupAt ?? 0)}
          </Typography.Text>
          <Typography.Text type="secondary" className="mono" style={{ fontSize: "var(--fs-xs)" }}>
            {describeBackup(backup)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: "var(--fs-xs)" }}>
            「恢复备份」会按该快照重新写入地址、网关与 DNS，属于写操作，需要二次确认。
          </Typography.Text>
        </Space>
      ) : (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            尚未保存备份快照。点击「应用配置」并确认后，程序会在写入前自动备份修改前的配置。
          </Typography.Text>
          {backupError ? (
            <Typography.Text type="warning" style={{ fontSize: "var(--fs-xs)" }}>
              上次备份未成功：{errorSummary(backupError)}
            </Typography.Text>
          ) : null}
        </Space>
      )}
    </SectionCard>
  );
}
