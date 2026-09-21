import { Button, Space, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { useState } from "react";
import { system as systemApi } from "../lib/api";
import { errorSummary, toAppError, type AppError } from "../lib/errors";
import { useAppStore } from "../state/store";

/** Shown whenever the process is not elevated: writes will be refused. */
export default function ElevationBanner() {
  const elevated = useAppStore((state) => state.status?.isElevated);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  if (elevated !== false) return null;

  const relaunch = async () => {
    setBusy(true);
    setError(null);
    try {
      await systemApi.relaunchAsAdmin();
    } catch (caught) {
      setError(toAppError(caught));
      setBusy(false);
    }
  };

  return (
    <div className="section" style={{ borderColor: "var(--amber)" }}>
      <div className="section__body" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <SafetyCertificateOutlined style={{ color: "var(--amber)", fontSize: 18 }} />
        <div style={{ flex: 1 }}>
          <Typography.Text strong>当前没有管理员权限</Typography.Text>
          <div style={{ fontSize: 12, color: "var(--text-soft)" }}>
            可以正常查看网卡信息；修改 IP / DNS、启用禁用网卡、改 MAC 需要管理员权限。
            {error ? " 提权失败：" + errorSummary(error) : ""}
          </div>
        </div>
        <Space>
          <Button type="primary" size="small" loading={busy} onClick={relaunch}>
            以管理员身份重启
          </Button>
        </Space>
      </div>
    </div>
  );
}
