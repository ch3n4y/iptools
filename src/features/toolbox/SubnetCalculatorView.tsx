import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Input,
  Slider,
  Space,
  Tag,
  Typography,
} from "antd";
import type { DescriptionsProps } from "antd";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { isNative } from "../../lib/api/native";
import { calculateSubnet } from "../../lib/api/toolbox";
import { errorSummary, toAppError, type AppError } from "../../lib/errors";
import { isPrivateIp } from "../../lib/format";
import type { SubnetCalc } from "../../lib/types";
import { MASK_HINT, parseIpv4, parseMaskPrefix } from "../../lib/ipv4";
import { useAppStore } from "../../state/store";

type CalcState = "idle" | "running" | "done" | "failed";
type IpClass = "A" | "B" | "C";

interface BannerState {
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string | null;
  error?: AppError | null;
}

const PREFIX_PRESETS: Array<{ cls: IpClass; prefix: number }> = [
  { cls: "A", prefix: 8 },
  { cls: "B", prefix: 16 },
  { cls: "C", prefix: 24 },
];

const STATE_LABEL: Record<CalcState, string> = {
  idle: "等待输入",
  running: "计算中",
  done: "已计算",
  failed: "输入有误",
};

const STATE_COLOR: Record<CalcState, string> = {
  idle: "default",
  running: "processing",
  done: "success",
  failed: "error",
};

const DEBOUNCE_MS = 200;


function classOfIp(value: string): IpClass | null {
  const first = Number.parseInt(value.trim().split(".")[0] ?? "", 10);
  if (Number.isNaN(first)) return null;
  if (first < 128) return "A";
  if (first < 192) return "B";
  if (first < 224) return "C";
  return null;
}

interface CopyableValueProps {
  text: string;
  label: string;
  onCopy: (text: string, label: string) => void;
}

/** Double-click (or Enter/Space) copies the value and reports the result. */
function CopyableValue({ text, label, onCopy }: CopyableValueProps) {
  return (
    <span
      className="mono copyable"
      role="button"
      tabIndex={0}
      title={`双击复制${label}`}
      aria-label={`${label}：${text}，双击复制`}
      onDoubleClick={() => onCopy(text, label)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCopy(text, label);
        }
      }}
    >
      {text}
    </span>
  );
}

export default function SubnetCalculatorView() {
  const { message } = AntApp.useApp();
  const setView = useAppStore((state) => state.setView);
  const setToolboxTool = useAppStore((state) => state.setToolboxTool);
  const setPendingScanSpec = useAppStore((state) => state.setPendingScanSpec);

  const [ipInput, setIpInput] = useState("");
  const [maskInput, setMaskInput] = useState("24");
  const [calcState, setCalcState] = useState<CalcState>("idle");
  const [calc, setCalc] = useState<SubnetCalc | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const seqRef = useRef(0);
  const lastPrefixRef = useRef(24);
  const copiedTimerRef = useRef<number | null>(null);

  const ipError = ipInput.trim() !== "" && parseIpv4(ipInput) === null
    ? "IP 地址格式不正确，应形如 192.168.1.10"
    : null;

  const maskPrefix = parseMaskPrefix(maskInput);
  let maskError: string | null = null;
  if (maskInput.trim() === "") {
    maskError = "请填写掩码，例如 24、/24 或 255.255.255.0";
  } else if (maskPrefix === null) {
    maskError = `掩码格式不支持：${MASK_HINT}`;
  }

  useEffect(() => {
    if (maskPrefix !== null) lastPrefixRef.current = maskPrefix;
  }, [maskPrefix]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // Debounced recalculation; invalid input shows an inline error instead.
  useEffect(() => {
    if (ipError || maskError) {
      seqRef.current += 1;
      setCalc(null);
      setCalcState("failed");
      return undefined;
    }
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setCalcState("running");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await calculateSubnet(ipInput.trim() === "" ? null : ipInput.trim(), maskInput.trim());
          if (seqRef.current !== seq) return;
          setCalc(result);
          setCalcState("done");
        } catch (error) {
          if (seqRef.current !== seq) return;
          const appError = toAppError(error);
          setCalc(null);
          setCalcState("failed");
          setBanner({
            level: "error",
            title: "子网计算失败",
            message: errorSummary(appError),
            error: appError,
          });
        }
      })();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ipInput, maskInput, ipError, maskError]);

  const sliderPrefix = maskPrefix ?? lastPrefixRef.current;
  const activeClass = useMemo(() => classOfIp(ipInput), [ipInput]);

  const privateShown = calc
    ? calc.isPrivate || isPrivateIp(calc.ip ?? calc.network)
    : false;

  function reportCopied(label: string) {
    setCopiedLabel(label);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedLabel(null);
    }, 2500);
  }

  async function onCopy(text: string, label: string) {
    if (!isNative()) {
      void message.warning("浏览器预览不可用：复制需要在桌面应用中使用");
      return;
    }
    try {
      await writeText(text);
      reportCopied(label);
      void message.success(`已复制${label}：${text}`);
    } catch (error) {
      const appError = toAppError(error);
      setBanner({
        level: "error",
        title: "复制失败",
        message: errorSummary(appError),
        error: appError,
      });
    }
  }

  function onScanNetwork() {
    if (!calc) return;
    const spec = `${calc.network}/${calc.prefix}`;
    // 扫描页由工具箱懒挂载，window 事件会在它挂载前就派发完、结果丢失；
    // 因此把网段写进 store，扫描页挂载后自己读取并消费一次。
    setPendingScanSpec(spec);
    setToolboxTool("scan");
    setView("toolbox");
    void message.success(`已把网段 ${spec} 交给网络扫描`);
  }

  const items: DescriptionsProps["items"] = calc
    ? [
        { key: "mask", label: "子网掩码", children: <CopyableValue text={calc.mask} label="子网掩码" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "prefix", label: "前缀长度", children: <span className="mono">{`/${calc.prefix}`}</span> },
        { key: "wildcard", label: "反掩码（双击复制）", children: <CopyableValue text={calc.wildcard} label="反掩码" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "network", label: "网络地址", children: <CopyableValue text={calc.network} label="网络地址" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "broadcast", label: "广播地址", children: <CopyableValue text={calc.broadcast} label="广播地址" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "firstHost", label: "第一个可用主机", children: <CopyableValue text={calc.firstHost} label="第一个可用主机" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "lastHost", label: "最后一个可用主机", children: <CopyableValue text={calc.lastHost} label="最后一个可用主机" onCopy={(text, label) => void onCopy(text, label)} /> },
        { key: "total", label: "地址总数", children: <span className="mono">{calc.totalAddresses.toLocaleString("zh-CN")}</span> },
        { key: "usable", label: "可用主机数", children: <span className="mono">{calc.usableHostCount.toLocaleString("zh-CN")}</span> },
        { key: "class", label: "地址类别", children: <span className="mono">{`${calc.ipClass} 类`}</span> },
        {
          key: "private",
          label: "私有地址",
          children: <Tag color={privateShown ? "green" : "default"}>{privateShown ? "是（RFC1918）" : "否"}</Tag>,
        },
      ]
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">掩码计算</h1>
          <p className="page-head__desc">
            由 IP 与掩码推算网络地址、广播地址、可用主机范围与反掩码；双击任意结果值即可复制。
          </p>
        </div>
        <div className="page-head__actions">
          <Button type="primary" onClick={onScanNetwork} disabled={!calc}>
            用该网段扫描
          </Button>
        </div>
      </div>

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
        title="输入"
        hint={`掩码支持 24、/24 或 255.255.255.0；输入变化后约 ${DEBOUNCE_MS} 毫秒自动重新计算。`}
      >
        <div className="kv-grid">
          <div className="kv">
            <label className="kv__label" htmlFor="subnet-ip">
              IP 地址（可留空）
            </label>
            <Input
              id="subnet-ip"
              value={ipInput}
              onChange={(event) => setIpInput(event.target.value)}
              placeholder="192.168.1.10"
              status={ipError ? "error" : undefined}
              aria-label="IP 地址"
              aria-invalid={ipError !== null}
              spellCheck={false}
            />
            {ipError ? (
              <Typography.Text type="danger">{ipError}</Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                留空时仅按掩码推算网络地址与主机范围。
              </Typography.Text>
            )}
          </div>
          <div className="kv">
            <label className="kv__label" htmlFor="subnet-mask">
              子网掩码
            </label>
            <Input
              id="subnet-mask"
              value={maskInput}
              onChange={(event) => setMaskInput(event.target.value)}
              placeholder="24 或 255.255.255.0"
              status={maskError ? "error" : undefined}
              aria-label="子网掩码"
              aria-invalid={maskError !== null}
              spellCheck={false}
            />
            {maskError ? (
              <Typography.Text type="danger">{maskError}</Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {`当前前缀长度 /${maskPrefix ?? "?"}`}
              </Typography.Text>
            )}
          </div>
          <div className="kv" style={{ gridColumn: "span 2" }}>
            <label className="kv__label" htmlFor="subnet-prefix">
              前缀长度（左右方向键可调整）
            </label>
            <Slider
              id="subnet-prefix"
              min={1}
              max={32}
              value={sliderPrefix}
              onChange={(value: number) => setMaskInput(String(value))}
              ariaLabelForHandle="子网掩码前缀长度"
              ariaValueTextFormatterForHandle={(value: number) => `/${value}`}
              tooltip={{ formatter: (value?: number) => (typeof value === "number" ? `/${value}` : "") }}
              style={{ maxWidth: 480 }}
            />
            <Space size={8} wrap>
              {PREFIX_PRESETS.map((preset) => (
                <Button
                  key={preset.cls}
                  type={activeClass === preset.cls ? "primary" : "default"}
                  onClick={() => setMaskInput(String(preset.prefix))}
                  aria-pressed={activeClass === preset.cls}
                  aria-label={`${preset.cls} 类默认掩码 /${preset.prefix}`}
                >
                  {`${preset.cls} 类 /${preset.prefix}`}
                </Button>
              ))}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {activeClass
                  ? `已按 IP 首字节判定为 ${activeClass} 类地址`
                  : "输入 IP 后会自动标出对应的地址类别"}
              </Typography.Text>
            </Space>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="计算结果"
        hint="网络地址与广播地址不可分配给主机；/31 为点对点链路，两端地址均可用。"
        extra={
          <Space size={12} wrap>
            <span aria-live="polite">
              状态：<Tag color={STATE_COLOR[calcState]}>{STATE_LABEL[calcState]}</Tag>
            </span>
            {calcState === "running" ? (
              <Typography.Text type="secondary">正在按最新输入重新计算…</Typography.Text>
            ) : null}
            {copiedLabel ? (
              <Typography.Text type="success">{`已复制${copiedLabel}`}</Typography.Text>
            ) : null}
          </Space>
        }
      >
        {calc ? (
          <>
            <Descriptions size="small" bordered column={2} items={items} />
            {calc.notes.length > 0 ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message="计算提示"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {calc.notes.map((note, index) => (
                      <li key={`${index}-${note}`}>{note}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
            <div className="tag-row" style={{ marginTop: 12 }}>
              <Button
                onClick={() => void onCopy(`${calc.firstHost} - ${calc.lastHost}`, "可用主机范围")}
              >
                复制主机范围
              </Button>
              <Button onClick={() => void onCopy(calc.wildcard, "反掩码")}>复制反掩码</Button>
              <Button onClick={() => void onCopy(calc.network, "网络地址")}>复制网络地址</Button>
              <Button onClick={() => void onCopy(calc.broadcast, "广播地址")}>复制广播地址</Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                桌面应用中双击或点击按钮均可复制；浏览器预览仅提示不可用。
              </Typography.Text>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state__title">
              {calcState === "failed" ? "无法计算" : "等待输入"}
            </div>
            <div>
              {calcState === "failed"
                ? "请检查上方 IP 地址与掩码的输入，修正后会自动重新计算。"
                : "填写 IP 地址（可留空）与掩码后，这里会显示网络地址、主机范围与反掩码。"}
            </div>
          </div>
        )}
      </SectionCard>
    </>
  );
}
