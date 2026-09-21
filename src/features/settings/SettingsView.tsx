import { useEffect, useState } from "react";
import { Button, InputNumber, Segmented, Space, Spin, Switch, Tag, Typography } from "antd";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { system as systemApi } from "../../lib/api";
import { isNative } from "../../lib/api/native";
import { toAppError, type AppError } from "../../lib/errors";
import type { ThemeMode } from "../../lib/types";
import { useAppStore } from "../../state/store";
import UpdateSection from "./UpdateSection";

const THEME_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return min;
  return Math.min(max, Math.max(min, rounded));
}

function CopyValue({ value, empty = "—" }: { value: string | null | undefined; empty?: string }) {
  if (!value) return <span className="kv__value kv__value--mono">{empty}</span>;
  return (
    <Typography.Text className="kv__value kv__value--mono copyable" copyable={{ text: value }}>
      {value}
    </Typography.Text>
  );
}

export default function SettingsView() {
  const settings = useAppStore((state) => state.settings);
  const status = useAppStore((state) => state.status);
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const patchSettings = useAppStore((state) => state.patchSettings);

  const [locationBusy, setLocationBusy] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<{
    level: "success" | "info" | "error";
    title: string;
    message?: string | null;
    error?: AppError | null;
  } | null>(null);

  const [elevated, setElevated] = useState<boolean | null>(status?.isElevated ?? null);
  const [elevateBusy, setElevateBusy] = useState(false);
  const [aboutFeedback, setAboutFeedback] = useState<{
    level: "success" | "info" | "error";
    title: string;
    message?: string | null;
    error?: AppError | null;
  } | null>(null);

  useEffect(() => {
    const controller = { cancelled: false };
    void systemApi
      .isElevated()
      .then((value) => {
        if (!controller.cancelled) setElevated(value);
      })
      .catch(() => {
        if (!controller.cancelled) setElevated(status?.isElevated ?? null);
      });
    return () => {
      controller.cancelled = true;
    };
    // `status` is only the fallback; the native probe is authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status) setElevated(status.isElevated);
  }, [status]);

  const openConfigDir = async () => {
    setLocationBusy(true);
    setLocationFeedback(null);
    try {
      const path = await systemApi.openAppLocation();
      setLocationFeedback({
        level: isNative() ? "success" : "info",
        title: isNative() ? "已打开配置目录" : "浏览器预览不会打开资源管理器",
        message: isNative()
          ? `已在资源管理器中打开：${path}`
          : `配置目录位于：${path}（仅桌面程序可打开）。`,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setLocationFeedback({
        level: "error",
        title: "打开配置目录失败",
        message: appError.code === "NOT_SUPPORTED" ? "浏览器预览不支持打开本地目录。" : null,
        error: appError,
      });
    } finally {
      setLocationBusy(false);
    }
  };

  const relaunch = async () => {
    setElevateBusy(true);
    setAboutFeedback(null);
    try {
      await systemApi.relaunchAsAdmin();
      setAboutFeedback({
        level: "success",
        title: "已请求以管理员身份重启",
        message: "系统会弹出 UAC 提示；确认后程序将以管理员权限重新启动。",
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setAboutFeedback({
        level: "error",
        title: "提权失败",
        message: appError.code === "NOT_SUPPORTED" ? "浏览器预览不能提权重启。" : null,
        error: appError,
      });
    } finally {
      setElevateBusy(false);
    }
  };

  const openNcpa = async () => {
    setAboutFeedback(null);
    try {
      await systemApi.openNetworkConnections();
      setAboutFeedback({
        level: "success",
        title: "已打开系统网络连接",
        message: undefined,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setAboutFeedback({
        level: "error",
        title: "打开网络连接失败",
        message:
          appError.code === "NOT_SUPPORTED"
            ? "浏览器预览不能打开 ncpa.cpl；请在桌面程序中使用该按钮。"
            : null,
        error: appError,
      });
    }
  };

  if (!settings) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">偏好设置</h1>
            <p className="page-head__desc">主题、刷新频率、应用前确认、配置位置与自动更新。</p>
          </div>
        </div>
        <SectionCard title="加载中">
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">正在读取设置…</Typography.Text>
          </Space>
        </SectionCard>
      </>
    );
  }

  const intervalSeconds = Math.max(2, Math.round(settings.refreshIntervalMs / 1000));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">偏好设置</h1>
          <p className="page-head__desc">
            所有改动都会立即保存到配置文件，无需手动确认。
            {status?.portable ? " 当前已检测到 portable.txt，配置存于程序目录。" : ""}
          </p>
        </div>
      </div>

      <SectionCard title="外观" hint="跟随系统会随系统主题自动切换">
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Segmented
            aria-label="主题模式"
            options={THEME_OPTIONS}
            value={themeMode}
            onChange={(value) => void setThemeMode(value as ThemeMode)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            选择「跟随系统」时会监听 Windows 的浅色 / 深色设置并即时切换；选择浅色或深色则固定使用该主题。
          </Typography.Text>
        </Space>
      </SectionCard>

      <SectionCard
        title="网卡刷新"
        hint="自动刷新会按固定间隔重新读取网卡列表；窗口不显示时会暂停轮询"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space align="center">
            <Switch
              aria-label="自动刷新网卡列表"
              checked={settings.autoRefreshAdapters}
              onChange={(checked) => void patchSettings({ autoRefreshAdapters: checked })}
            />
            <Typography.Text>自动刷新网卡状态</Typography.Text>
          </Space>
          <Space align="center">
            <Typography.Text type={settings.autoRefreshAdapters ? undefined : "secondary"}>
              刷新间隔
            </Typography.Text>
            <InputNumber
              min={2}
              max={600}
              step={1}
              style={{ width: 120 }}
              disabled={!settings.autoRefreshAdapters}
              value={intervalSeconds}
              addonAfter="秒"
              onChange={(value) => {
                if (typeof value !== "number" || !Number.isFinite(value)) return;
                void patchSettings({ refreshIntervalMs: clampInt(value, 2, 600) * 1000 });
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最小 2 秒（当前 {intervalSeconds} 秒）
            </Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            轮询会调用系统接口读取网卡信息，间隔过小会增加后台开销；窗口最小化或被遮挡时不会执行轮询。
          </Typography.Text>
        </Space>
      </SectionCard>

      <SectionCard title="应用行为" hint="控制写入前的确认与启动检查">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space align="center">
            <Switch
              aria-label="应用配置前二次确认"
              checked={settings.confirmBeforeApply}
              onChange={(checked) => void patchSettings({ confirmBeforeApply: checked })}
            />
            <Typography.Text>应用配置前弹出确认框</Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            关闭后点击「应用配置」会直接写入系统，不再显示变更清单与警告，建议保持开启。
          </Typography.Text>
          <Space align="center">
            <Switch
              aria-label="启动时检查更新"
              checked={settings.checkUpdateOnStart}
              onChange={(checked) => void patchSettings({ checkUpdateOnStart: checked })}
            />
            <Typography.Text>启动时检查更新</Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            开启后程序启动会在后台查询更新源，发现新版本时在本页「自动更新」中给出提示，不会自动安装。
          </Typography.Text>
        </Space>
      </SectionCard>

      <SectionCard
        title="配置位置"
        hint="写入当前用户目录；程序目录存在 portable.txt 时自动改用程序目录"
        extra={
          <Button loading={locationBusy} onClick={() => void openConfigDir()}>
            打开配置目录
          </Button>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {locationFeedback ? (
            <StatusBanner
              level={locationFeedback.level}
              title={locationFeedback.title}
              message={locationFeedback.message}
              error={locationFeedback.error}
              onDismiss={() => setLocationFeedback(null)}
            />
          ) : null}

          <div className="kv-grid">
            <div className="kv">
              <span className="kv__label">配置目录</span>
              <CopyValue value={status?.configDir} empty="尚未读取" />
            </div>
            <div className="kv">
              <span className="kv__label">设置文件 settings.json</span>
              <CopyValue value={status?.settingsPath} empty="尚未读取" />
            </div>
            <div className="kv">
              <span className="kv__label">方案文件 schemes.json</span>
              <CopyValue value={status?.schemesPath} empty="尚未读取" />
            </div>
          </div>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            配置默认位于 %APPDATA%\iptools；若程序目录存在 portable.txt，则自动改用程序目录存放配置（绿色版）。
          </Typography.Text>
          {status?.portable ? (
            <Tag color="blue">已检测到 portable.txt，当前使用程序目录</Tag>
          ) : (
            <Tag>未检测到 portable.txt，当前使用用户目录</Tag>
          )}
        </Space>
      </SectionCard>

      <UpdateSection />

      <SectionCard title="关于" hint="版本信息、运行环境与快捷入口">
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          {aboutFeedback ? (
            <StatusBanner
              level={aboutFeedback.level}
              title={aboutFeedback.title}
              message={aboutFeedback.message}
              error={aboutFeedback.error}
              onDismiss={() => setAboutFeedback(null)}
            />
          ) : null}

          <div className="kv-grid">
            <div className="kv">
              <span className="kv__label">程序版本</span>
              <span className="kv__value kv__value--mono">{status?.version ?? "尚未读取"}</span>
            </div>
            <div className="kv">
              <span className="kv__label">运行环境</span>
              <span className="kv__value">{status?.osDescription ?? "尚未读取"}</span>
            </div>
            <div className="kv">
              <span className="kv__label">管理员权限</span>
              <span className="kv__value">
                {elevated === null ? (
                  "检测中…"
                ) : elevated ? (
                  <Tag color="green">已提权（可写入系统配置）</Tag>
                ) : (
                  <Tag color="orange">未提权（写入会被拒绝）</Tag>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__label">配置目录</span>
              <CopyValue value={status?.configDir} empty="尚未读取" />
            </div>
          </div>

          <Space wrap>
            {elevated === false ? (
              <Button type="primary" loading={elevateBusy} onClick={() => void relaunch()}>
                以管理员身份重启
              </Button>
            ) : null}
            <Button onClick={() => void openNcpa()}>打开网络连接（ncpa.cpl）</Button>
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            修改 IP / DNS、启用禁用网卡都需要管理员权限；只读查看不需要。
          </Typography.Text>
        </Space>
      </SectionCard>
    </>
  );
}
