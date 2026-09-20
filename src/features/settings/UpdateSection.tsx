import { useEffect, useState } from "react";
import { Button, Progress, Space, Spin, Tag, Typography } from "antd";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { app as appApi } from "../../lib/api";
import { toAppError, type AppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import type { UpdateInfo, UpdateProgress } from "../../lib/types";

/** Auto-update: check, then download-and-install with live progress. */
export default function UpdateSection() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void appApi
      .subscribeUpdateProgress((next) => setProgress(next))
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else unlisten = unsubscribe;
      })
      .catch(() => {
        /* the progress stream is best-effort; failures are already surfaced by the install call */
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await appApi.checkUpdate();
      setInfo(result);
    } catch (caught) {
      setInfo(null);
      setError(toAppError(caught));
    } finally {
      setChecking(false);
    }
  };

  const runInstall = async () => {
    setInstalling(true);
    setError(null);
    setMessage(null);
    setProgress(null);
    try {
      const result = await appApi.installUpdate();
      setMessage(result);
      setInfo((current) => (current ? { ...current, available: false } : current));
    } catch (caught) {
      setError(toAppError(caught));
    } finally {
      setInstalling(false);
    }
  };

  const downloaded = progress?.downloaded ?? 0;
  const percent = progress
    ? progress.total && progress.total > 0
      ? Math.min(100, Math.round((downloaded / progress.total) * 100))
      : progress.finished
        ? 100
        : 0
    : 0;

  return (
    <SectionCard
      title="自动更新"
      hint="从配置的更新源检查新版本；安装完成后需要重启程序才会生效"
      extra={
        <Button onClick={() => void runCheck()} loading={checking} disabled={installing}>
          检查更新
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {error ? (
          <StatusBanner
            level="error"
            title={installing ? "下载或安装更新失败" : "检查更新失败"}
            message={
              error.code === "NOT_SUPPORTED"
                ? "当前环境不支持自动更新（浏览器预览，或未配置更新源）。"
                : null
            }
            error={error}
            actions={[{ label: "重试", onClick: () => void runCheck(), primary: true }]}
          />
        ) : null}

        {message ? (
          <StatusBanner
            level="success"
            title="更新已下载并安装"
            message={`${message}。请重启本程序以运行新版本。`}
          />
        ) : null}

        {checking ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">正在检查更新…</Typography.Text>
          </Space>
        ) : null}

        {!checking && info?.available ? (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color="blue">发现新版本</Tag>
              <Typography.Text>
                当前版本 <span className="mono">v{info.currentVersion}</span>
                <span aria-hidden="true"> → </span>
                新版本 <span className="mono">{info.version ?? "未知"}</span>
              </Typography.Text>
            </Space>
            {info.date ? (
              <Typography.Text type="secondary">
                发布日期：<span className="mono">{info.date}</span>
              </Typography.Text>
            ) : null}
            {info.notes ? (
              <Typography.Paragraph
                style={{ whiteSpace: "pre-wrap", marginBottom: 0, maxHeight: 160, overflow: "auto" }}
              >
                {info.notes}
              </Typography.Paragraph>
            ) : (
              <Typography.Text type="secondary">该版本未提供更新说明。</Typography.Text>
            )}
            <Space>
              <Button type="primary" loading={installing} disabled={installing} onClick={() => void runInstall()}>
                下载并安装
              </Button>
              {installing ? (
                <Typography.Text type="secondary">正在下载并安装，请勿关闭程序…</Typography.Text>
              ) : null}
            </Space>
          </Space>
        ) : null}

        {installing || progress ? (
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Progress
              percent={percent}
              status={progress?.finished ? "success" : "active"}
              size="small"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已下载 <span className="mono">{formatBytes(downloaded)}</span>
              {progress?.total ? (
                <>
                  {" / "}
                  <span className="mono">{formatBytes(progress.total)}</span>
                </>
              ) : null}
              {progress?.finished ? " · 下载完成，正在校验安装包" : ""}
            </Typography.Text>
          </Space>
        ) : null}

        {!checking && info && !info.available && !info.error ? (
          <StatusBanner
            level="success"
            title="已是最新版本"
            message={`当前版本 v${info.currentVersion}，无需更新。`}
          />
        ) : null}

        {!checking && info && !info.available && info.error ? (
          <StatusBanner
            level={info.unsupported ? "info" : "warning"}
            title={info.unsupported ? "当前环境不支持自动更新" : "检查更新失败"}
            message={info.error}
          />
        ) : null}

        {!checking && !info && !error && !message ? (
          <Typography.Text type="secondary">
            尚未检查更新；点击右上角「检查更新」查询新版本。
          </Typography.Text>
        ) : null}
      </Space>
    </SectionCard>
  );
}
