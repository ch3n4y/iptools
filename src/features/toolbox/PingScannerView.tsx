import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Input,
  InputNumber,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { isNative } from "../../lib/api/native";
import {
  cancelPing,
  defaultScanSpec,
  expandPingTargets,
  exportPingCsv,
  startPing,
  subscribePingProgress,
} from "../../lib/api/toolbox";
import { errorSummary, toAppError, type AppError } from "../../lib/errors";
import { hostOfAdapter, pingResultsToCsv, pingSummary } from "../../lib/format";
import type { PingDefaults, PingMode, PingRequest, PingResult, TargetList } from "../../lib/types";
import { currentAdapter, useAppStore } from "../../state/store";
import ResultTable from "./ResultTable";

type RunState = "idle" | "running" | "done" | "cancelled" | "failed";

interface BannerState {
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string | null;
  error?: AppError | null;
}

interface Stats {
  total: number;
  done: number;
  alive: number;
}

/** Mirrors the Rust defaults so the form is usable before settings load. */
const FALLBACK_DEFAULTS: PingDefaults = {
  mode: "arp",
  concurrency: 64,
  timeoutMs: 1000,
  slow: false,
  prefix: 24,
  multipass: true,
  multipassRounds: 3,
};

const MODE_OPTIONS: Array<{ label: string; value: PingMode }> = [
  { label: "ARP（推荐）", value: "arp" },
  { label: "ICMP", value: "icmp" },
  { label: "系统 ping", value: "system" },
];

const MODE_LABEL: Record<PingMode, string> = {
  arp: "ARP",
  icmp: "ICMP",
  system: "系统 ping",
};

const STATE_LABEL: Record<RunState, string> = {
  idle: "空闲",
  running: "扫描中",
  done: "已完成",
  cancelled: "已停止",
  failed: "失败",
};

const STATE_COLOR: Record<RunState, string> = {
  idle: "default",
  running: "processing",
  done: "success",
  cancelled: "warning",
  failed: "error",
};

const EMPTY_STATS: Stats = { total: 0, done: 0, alive: 0 };

export default function PingScannerView() {
  const { message } = AntApp.useApp();
  const settingsPing = useAppStore((state) => state.settings?.ping ?? null);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const adapter = useAppStore(currentAdapter);
  const pendingScanSpec = useAppStore((state) => state.pendingScanSpec);
  const setPendingScanSpec = useAppStore((state) => state.setPendingScanSpec);

  // --- parameters (two-way synced with settings.ping) --------------------
  const [params, setParams] = useState<PingDefaults>(FALLBACK_DEFAULTS);
  const paramsRef = useRef<PingDefaults>(FALLBACK_DEFAULTS);
  const lastWriteRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const adapterRef = useRef(adapter);

  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  // Follow the store; skip the echo of our own debounced write.
  useEffect(() => {
    if (!settingsPing) return;
    if (lastWriteRef.current === JSON.stringify(settingsPing)) return;
    paramsRef.current = settingsPing;
    setParams(settingsPing);
  }, [settingsPing]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  function commitParams(next: PingDefaults) {
    lastWriteRef.current = JSON.stringify(next);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void patchSettings({ ping: next });
    }, 400);
  }

  function updateParams(patch: Partial<PingDefaults>) {
    const next = { ...paramsRef.current, ...patch };
    paramsRef.current = next;
    setParams(next);
    commitParams(next);
  }

  // --- targets ----------------------------------------------------------
  const [spec, setSpec] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [specErrors, setSpecErrors] = useState<string[]>([]);
  const [expandedSpec, setExpandedSpec] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);

  // --- run state --------------------------------------------------------
  const [runState, setRunState] = useState<RunState>("idle");
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [results, setResults] = useState<PingResult[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [onlyAlive, setOnlyAlive] = useState(false);
  const [keyword, setKeyword] = useState("");

  const resultsRef = useRef<PingResult[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const running = runState === "running";
  const busy = starting || expanding || exporting || copying;

  // Initial spec: the first connected adapter's network (or a sane fallback).
  useEffect(() => {
    let disposed = false;
    defaultScanSpec()
      .then((value) => {
        if (disposed) return;
        setSpec((current) => (current.trim() ? current : value));
      })
      .catch((error) => {
        if (disposed) return;
        setBanner({
          level: "error",
          title: "无法获取默认扫描网段",
          error: toAppError(error),
        });
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Progress feed; the listener is dropped on unmount.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void subscribePingProgress((progress) => {
      if (progress.jobId !== jobIdRef.current) return;
      resultsRef.current = progress.results;
      setResults(progress.results);
      setStats({ total: progress.total, done: progress.done, alive: progress.alive });
      if (!progress.finished) return;
      const cancelled = cancelRequestedRef.current;
      cancelRequestedRef.current = false;
      jobIdRef.current = null;
      setJobId(null);
      setRunState(cancelled ? "cancelled" : "done");
      setBanner(
        cancelled
          ? {
              level: "warning",
              title: "扫描已停止",
              message: `已完成 ${progress.done} / ${progress.total}，在线 ${progress.alive}。`,
            }
          : {
              level: "success",
              title: "扫描完成",
              message: `共 ${progress.total} 个目标，在线 ${progress.alive} 个。`,
            },
      );
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        if (!disposed) {
          setBanner({
            level: "error",
            title: "无法订阅扫描进度",
            error: toAppError(error),
          });
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 掩码计算页把网段写进 store，本页挂载后读取并消费一次（不依赖挂载时序）。
  useEffect(() => {
    const next = pendingScanSpec?.trim();
    if (!next) return;
    setSpec(next);
    setTargets([]);
    setSpecErrors([]);
    setExpandedSpec(null);
    setPendingScanSpec(null);
    void message.info(`已载入扫描目标：${next}`);
  }, [pendingScanSpec, setPendingScanSpec, message]);

  const summary = useMemo(() => pingSummary(results), [results]);

  const visibleRows = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return results.filter((row) => {
      if (onlyAlive && !row.alive) return false;
      if (!needle) return true;
      return (
        row.target.toLowerCase().includes(needle) ||
        (row.mac ?? "").toLowerCase().includes(needle) ||
        (row.error ?? "").toLowerCase().includes(needle)
      );
    });
  }, [results, onlyAlive, keyword]);

  const percent = stats.total > 0 ? Math.min(100, Math.round((stats.done / stats.total) * 100)) : 0;

  // --- handlers ---------------------------------------------------------
  function applySpec(next: string) {
    setSpec(next);
    setTargets([]);
    setSpecErrors([]);
    setExpandedSpec(null);
  }

  async function runExpand(text: string): Promise<TargetList | null> {
    setExpanding(true);
    try {
      const list = await expandPingTargets(text);
      setTargets(list.targets);
      setSpecErrors(list.errors);
      setExpandedSpec(text);
      return list;
    } catch (error) {
      setBanner({ level: "error", title: "展开目标失败", error: toAppError(error) });
      return null;
    } finally {
      setExpanding(false);
    }
  }

  function onExpand() {
    const text = spec.trim();
    if (!text) {
      setBanner({ level: "warning", title: "请先填写目标", message: "例如 192.168.1.0/24" });
      return;
    }
    void runExpand(text).then((list) => {
      if (!list) return;
      if (list.targets.length === 0) {
        setBanner({ level: "warning", title: "没有解析出任何目标", message: list.errors.join("；") });
        return;
      }
      setBanner({
        level: "success",
        title: `已展开 ${list.targets.length} 个目标`,
        message: list.errors.length ? `另有 ${list.errors.length} 条输入无法解析` : null,
      });
    });
  }

  async function onUseAdapterSegment() {
    const current = adapterRef.current;
    const entry = current?.ipv4.addresses[0];
    if (current && entry && entry.prefix >= 8 && entry.prefix <= 32) {
      const network = hostOfAdapter(entry.address, entry.prefix);
      const next = `${network}/${entry.prefix}`;
      applySpec(next);
      void message.success(`已使用「${current.name}」的网段 ${next}`);
      return;
    }
    try {
      const next = await defaultScanSpec();
      applySpec(next);
      void message.success(`已使用默认网段 ${next}`);
    } catch (error) {
      setBanner({ level: "error", title: "无法获取默认网段", error: toAppError(error) });
    }
  }

  async function onStart() {
    const text = spec.trim();
    if (!text) {
      setBanner({ level: "warning", title: "请先填写扫描目标", message: "例如 192.168.1.0/24" });
      return;
    }
    if (running) return;
    setStarting(true);
    setBanner(null);
    try {
      const list = await expandPingTargets(text);
      setTargets(list.targets);
      setSpecErrors(list.errors);
      setExpandedSpec(text);
      if (list.targets.length === 0) {
        setRunState("failed");
        setBanner({
          level: "error",
          title: "没有可扫描的目标",
          message: list.errors.join("；") || "请检查输入的地址、网段或范围格式",
        });
        return;
      }
      const nextJobId = `scan-${Date.now()}`;
      const request: PingRequest = {
        jobId: nextJobId,
        targets: list.targets,
        mode: params.mode,
        concurrency: params.concurrency,
        timeoutMs: params.timeoutMs,
        slow: params.slow,
        localIp: adapterRef.current?.ipv4.addresses[0]?.address ?? null,
        multipass: params.multipass,
        multipassRounds: params.multipassRounds,
      };
      jobIdRef.current = nextJobId;
      cancelRequestedRef.current = false;
      resultsRef.current = [];
      setJobId(nextJobId);
      setResults([]);
      setStats({ total: list.targets.length, done: 0, alive: 0 });
      setRunState("running");
      await startPing(request);
      setBanner({
        level: "info",
        title: "扫描已开始",
        message: `共 ${list.targets.length} 个目标，模式 ${MODE_LABEL[params.mode]}，并发 ${params.concurrency}。`,
      });
    } catch (error) {
      const appError = toAppError(error);
      jobIdRef.current = null;
      setJobId(null);
      setRunState("failed");
      setBanner({
        level: "error",
        title: "扫描启动失败",
        message: errorSummary(appError),
        error: appError,
      });
    } finally {
      setStarting(false);
    }
  }

  async function onStop() {
    const current = jobIdRef.current;
    if (!current) return;
    cancelRequestedRef.current = true;
    try {
      await cancelPing(current);
      setBanner({
        level: "warning",
        title: "已请求停止扫描",
        message: "已发出的探测会尽快结束，未开始的目标将被跳过。",
      });
    } catch (error) {
      const appError = toAppError(error);
      cancelRequestedRef.current = false;
      setBanner({ level: "error", title: "停止扫描失败", message: errorSummary(appError), error: appError });
    }
  }

  async function onExport() {
    const rows = resultsRef.current;
    if (rows.length === 0) {
      void message.warning("没有可导出的结果");
      return;
    }
    if (!isNative()) {
      void message.warning("浏览器预览不可用：导出 CSV 需要在桌面应用中使用");
      return;
    }
    setExporting(true);
    try {
      const stamp = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const path = await save({
        title: "导出扫描结果",
        defaultPath: `ping-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(
          stamp.getHours(),
        )}${pad(stamp.getMinutes())}.csv`,
        filters: [{ name: "CSV 文件", extensions: ["csv"] }],
      });
      if (!path) return;
      const saved = await exportPingCsv(path, rows);
      setBanner({ level: "success", title: "已导出扫描结果", message: saved });
    } catch (error) {
      const appError = toAppError(error);
      setBanner({ level: "error", title: "导出失败", message: errorSummary(appError), error: appError });
    } finally {
      setExporting(false);
    }
  }

  async function onCopy() {
    const rows = resultsRef.current;
    if (rows.length === 0) {
      void message.warning("没有可复制的结果");
      return;
    }
    if (!isNative()) {
      void message.warning("浏览器预览不可用：复制结果需要在桌面应用中使用");
      return;
    }
    setCopying(true);
    try {
      await writeText(pingResultsToCsv(rows));
      void message.success(`已复制 ${rows.length} 行结果到剪贴板`);
    } catch (error) {
      const appError = toAppError(error);
      setBanner({ level: "error", title: "复制结果失败", message: errorSummary(appError), error: appError });
    } finally {
      setCopying(false);
    }
  }

  function onClear() {
    resultsRef.current = [];
    setResults([]);
    setStats(EMPTY_STATS);
    setRunState("idle");
    setJobId(null);
    setOnlyAlive(false);
    setKeyword("");
    setBanner(null);
  }

  const previewNotice = isNative()
    ? null
    : "浏览器预览无法真正发包：可以展开目标、调整参数，开始扫描会提示需要在桌面应用中使用。";

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">网络扫描</h1>
          <p className="page-head__desc">
            批量扫描网段内主机的在线状态与 MAC 地址，支持 ARP / ICMP / 系统 ping，并可在快速与慢速之间切换。
          </p>
        </div>
        <div className="page-head__actions">
          <Button onClick={() => void onExport()} loading={exporting} disabled={busy && !exporting}>
            导出 CSV
          </Button>
          <Button onClick={() => void onCopy()} loading={copying} disabled={busy && !copying}>
            复制结果
          </Button>
          <Button onClick={onClear} disabled={running || results.length === 0}>
            清空结果
          </Button>
        </div>
      </div>

      {previewNotice ? (
        <Alert type="info" showIcon message="浏览器预览模式" description={previewNotice} style={{ marginBottom: 16 }} />
      ) : null}

      {banner ? (
        <StatusBanner
          level={banner.level}
          title={banner.title}
          message={banner.message}
          error={banner.error}
          onDismiss={() => setBanner(null)}
        />
      ) : null}

      <SectionCard
        title="扫描目标"
        hint="支持单个地址、逗号或空格分隔、192.168.1.0/24 网段、192.168.1.10-20 范围；单次最多 4096 个地址。"
        extra={
          <Space>
            <Button onClick={onUseAdapterSegment} disabled={running || busy}>
              使用当前网卡网段
            </Button>
            <Button onClick={onExpand} loading={expanding} disabled={running || busy}>
              展开目标
            </Button>
          </Space>
        }
      >
        <Input.TextArea
          value={spec}
          onChange={(event) => applySpec(event.target.value)}
          disabled={running}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder={"192.168.1.0/24\n192.168.1.10-20, 192.168.1.1 192.168.1.254"}
          aria-label="扫描目标"
          spellCheck={false}
        />
        <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
          <Space size={8} wrap>
            <Tag color={targets.length > 0 ? "blue" : "default"}>
              {expandedSpec === null ? "尚未展开目标" : `已展开 ${targets.length} 个目标`}
            </Tag>
            {expandedSpec !== null && targets.length > 0 ? (
              <Typography.Text type="secondary">
                {`示例：${targets.slice(0, 3).join("、")}${targets.length > 3 ? " …" : ""}`}
              </Typography.Text>
            ) : null}
            {adapter ? (
              <Typography.Text type="secondary">
                {`当前网卡：${adapter.name}${
                  adapter.ipv4.addresses[0]
                    ? `（${adapter.ipv4.addresses[0].address}/${adapter.ipv4.addresses[0].prefix}）`
                    : ""
                }`}
              </Typography.Text>
            ) : null}
          </Space>
          {specErrors.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`有 ${specErrors.length} 条输入无法解析`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {specErrors.map((item, index) => (
                    <li key={`${index}-${item}`} className="cell-mono">
                      {item}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
        </Space>
      </SectionCard>

      <SectionCard title="扫描参数" hint="参数会随设置一起保存，下次打开时沿用。">
        <div className="kv-grid">
          <div className="kv">
            <span className="kv__label" id="ping-mode-label">
              扫描模式
            </span>
            <Segmented<PingMode>
              options={MODE_OPTIONS}
              value={params.mode}
              disabled={running}
              aria-labelledby="ping-mode-label"
              onChange={(value) => updateParams({ mode: value })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ARP 推荐：可发现不响应 ICMP 的主机；ICMP 需要目标允许回显请求；系统 ping 调用
              Windows ping.exe。
            </Typography.Text>
          </div>
          <div className="kv">
            <label className="kv__label" htmlFor="ping-timeout">
              超时（毫秒，100-10000）
            </label>
            <InputNumber
              id="ping-timeout"
              min={100}
              max={10000}
              step={100}
              value={params.timeoutMs}
              disabled={running}
              onChange={(value) => {
                if (typeof value === "number") updateParams({ timeoutMs: value });
              }}
              aria-label="超时时间"
              style={{ width: 180 }}
            />
          </div>
          <div className="kv">
            <span className="kv__label" id="ping-speed-label">
              速度
            </span>
            <Segmented<"fast" | "slow">
              options={[
                { label: "快速", value: "fast" },
                { label: "慢速", value: "slow" },
              ]}
              value={params.slow ? "slow" : "fast"}
              disabled={running}
              aria-labelledby="ping-speed-label"
              onChange={(value) => updateParams({ slow: value === "slow" })}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              快速＝按并发数同时发包，地址之间不额外等待；慢速＝每个地址的多轮探测之间插入约
              350 毫秒延时，减轻对老旧或探测频率受限设备的冲击，耗时明显更长。
            </Typography.Text>
          </div>
        </div>

        <Collapse
          ghost
          style={{ marginTop: 8 }}
          items={[
            {
              key: "advanced",
              label: "高级参数",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div className="kv">
                    <label className="kv__label" htmlFor="ping-concurrency">
                      并发数（1-256）
                    </label>
                    <InputNumber
                      id="ping-concurrency"
                      min={1}
                      max={256}
                      step={1}
                      value={params.concurrency}
                      disabled={running}
                      onChange={(value) => {
                        if (typeof value === "number") updateParams({ concurrency: value });
                      }}
                      aria-label="并发数"
                      style={{ width: 180 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      同时处于探测中的地址数量；机器性能或网络设备受限时可以调低。
                    </Typography.Text>
                  </div>
                  <div className="kv">
                    <label className="kv__label" htmlFor="ping-multipass">
                      多连发
                    </label>
                    <Space size={10}>
                      <Switch
                        id="ping-multipass"
                        checked={params.multipass}
                        disabled={running}
                        onChange={(checked) => updateParams({ multipass: checked })}
                        aria-label="多连发开关"
                      />
                      <InputNumber
                        min={1}
                        max={10}
                        step={1}
                        value={params.multipassRounds}
                        disabled={running || !params.multipass}
                        onChange={(value) => {
                          if (typeof value === "number") updateParams({ multipassRounds: value });
                        }}
                        aria-label="多连发轮次"
                        addonAfter="轮"
                        style={{ width: 140 }}
                      />
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      对每个地址重复探测并合并最快 / 最慢延时与丢包数，用于发现不稳定的设备。
                    </Typography.Text>
                  </div>
                </Space>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="扫描进度"
        hint={jobId ? `任务 ${jobId}` : "尚未启动扫描任务"}
        extra={
          <Space>
            <Button
              type="primary"
              onClick={() => void onStart()}
              loading={starting}
              disabled={running || busy}
            >
              {runState === "idle" ? "开始扫描" : "重新扫描"}
            </Button>
            <Button danger onClick={() => void onStop()} disabled={!running}>
              停止
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div
            className="progress-strip"
            role="progressbar"
            aria-label="扫描进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="progress-strip__bar" style={{ width: `${percent}%` }} />
          </div>
          <Space size={16} wrap>
            <span>
              状态：
              <Tag color={STATE_COLOR[runState]}>{STATE_LABEL[runState]}</Tag>
            </span>
            <span className="mono">{`完成 ${stats.done} / ${stats.total}`}</span>
            <span className="mono">{`在线 ${stats.alive}`}</span>
            <span className="mono">{`进度 ${percent}%`}</span>
          </Space>
          <Typography.Text type="secondary">
            {running
              ? "正在扫描，进度条与计数会实时更新。"
              : "点击「开始扫描」后这里会显示完成数、在线数与总进度。"}
          </Typography.Text>
        </Space>
      </SectionCard>

      <SectionCard
        title="扫描结果"
        hint={`总数 ${summary.total} · 在线 ${summary.alive} · 离线 ${summary.dead} · 带 MAC ${summary.withMac}${
          visibleRows.length === results.length ? "" : ` · 当前显示 ${visibleRows.length}`
        }`}
        extra={
          <Space size={12} wrap>
            <Space size={6}>
              <Switch
                size="small"
                checked={onlyAlive}
                onChange={setOnlyAlive}
                aria-label="只看在线"
              />
              <span>只看在线</span>
            </Space>
            <Input
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="过滤地址 / MAC / 说明"
              aria-label="结果关键字过滤"
              style={{ width: 220 }}
            />
          </Space>
        }
        flush
      >
        <ResultTable
          rows={visibleRows}
          emptyText={
            <div className="empty-state">
              <div className="empty-state__title">
                {summary.total === 0 ? "暂无扫描结果" : "没有符合当前筛选条件的结果"}
              </div>
              <div>{summary.total === 0 ? "展开目标并开始扫描后，这里会显示每个地址的状态与延时。" : "试着关闭「只看在线」或清空关键字。"}</div>
            </div>
          }
        />
      </SectionCard>
    </>
  );
}
