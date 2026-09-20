import { App as AntApp, Button, Collapse, Dropdown, Input, Modal, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import type { MenuProps, TableProps } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import ConfirmApplyDialog from "../../components/ConfirmApplyDialog";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { schemes as schemesApi } from "../../lib/api";
import { isNative } from "../../lib/api/native";
import { toAppError, type AppError } from "../../lib/errors";
import { formatTimestamp } from "../../lib/format";
import type { ApplyPlan, ApplyResult, ImportReport, Scheme } from "../../lib/types";
import { APPLY_SELECTED_SCHEME_EVENT, currentAdapter, useAppStore } from "../../state/store";
import ApplyResultPanel, { describeApplyResult } from "./ApplyResultPanel";
import SchemeEditorModal from "./SchemeEditorModal";
import { SchemeMatchCell, SchemeSummaryCell } from "./SchemeCells";
import { blankScheme, duplicateScheme } from "./address";

interface Banner {
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string | null;
  error?: AppError | null;
}

interface PendingImport {
  report: ImportReport;
  source: string;
}

interface ImportOutcome {
  report: ImportReport;
  source: string;
  overwrite: boolean;
  imported: number;
}

export default function SchemesView() {
  const { message } = AntApp.useApp();
  const schemes = useAppStore((state) => state.schemes);
  const schemesLoading = useAppStore((state) => state.schemesLoading);
  const refreshSchemes = useAppStore((state) => state.refreshSchemes);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);
  const identity = useAppStore((state) => state.identity);
  const adapter = useAppStore(currentAdapter);

  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorScheme, setEditorScheme] = useState<Scheme | null>(null);
  const [editorError, setEditorError] = useState<AppError | null>(null);

  const [renameTarget, setRenameTarget] = useState<Scheme | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Scheme | null>(null);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureName, setCaptureName] = useState("");

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importChoice, setImportChoice] = useState<PendingImport | null>(null);
  const [importOutcome, setImportOutcome] = useState<ImportOutcome | null>(null);

  const [location, setLocation] = useState<string | null>(null);

  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [planTarget, setPlanTarget] = useState<Scheme | null>(null);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<{ result: ApplyResult; action: string } | null>(null);

  const adapterId = adapter?.id ?? null;
  const hostname = identity?.computerName ?? null;
  const selectedScheme = schemes.find((item) => item.id === selectedId) ?? null;
  const working = busy || applying || planLoading || importBusy;

  const phase: "loading" | "empty" | "ready" =
    schemesLoading && schemes.length === 0 ? "loading" : schemes.length === 0 ? "empty" : "ready";

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const path = await schemesApi.schemesLocation();
        if (alive) setLocation(path);
      } catch {
        if (alive) setLocation(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ensureNative = (action: string): boolean => {
    if (isNative()) return true;
    message.info(`${action}需要在桌面应用中使用（浏览器预览不可用）`);
    return false;
  };

  const openEditor = (scheme: Scheme | null) => {
    setEditorError(null);
    setEditorScheme(scheme);
    setEditorOpen(true);
  };

  const saveEditor = async (next: Scheme) => {
    setBusy(true);
    setEditorError(null);
    try {
      const saved = await schemesApi.saveScheme(next);
      setEditorOpen(false);
      setEditorScheme(null);
      await refreshSchemes();
      setSelectedId(saved.id);
      setBanner({ level: "success", title: `已保存方案「${saved.name}」` });
    } catch (caught) {
      setEditorError(toAppError(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmRename = async () => {
    const target = renameTarget;
    if (!target) return;
    const name = renameValue.trim();
    if (!name) {
      message.warning("请填写新的方案名称");
      return;
    }
    setBusy(true);
    try {
      await schemesApi.saveScheme({ ...target, name });
      await refreshSchemes();
      setRenameTarget(null);
      setBanner({ level: "success", title: `已重命名为「${name}」` });
    } catch (caught) {
      setBanner({ level: "error", title: "重命名失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setBusy(true);
    try {
      await schemesApi.deleteScheme(target.id);
      await refreshSchemes();
      if (selectedId === target.id) setSelectedId("");
      setDeleteTarget(null);
      setBanner({ level: "success", title: `已删除方案「${target.name}」` });
    } catch (caught) {
      setDeleteTarget(null);
      setBanner({ level: "error", title: "删除方案失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const move = async (scheme: Scheme, direction: -1 | 1) => {
    const index = schemes.findIndex((item) => item.id === scheme.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= schemes.length) return;
    const ids = schemes.map((item) => item.id);
    const swapped = ids[index];
    ids[index] = ids[target];
    ids[target] = swapped;
    setBusy(true);
    try {
      await schemesApi.reorderSchemes(ids);
      await refreshSchemes();
    } catch (caught) {
      setBanner({ level: "error", title: "调整方案顺序失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const confirmCapture = async () => {
    if (!adapterId) {
      message.warning("请先在主界面选择目标网卡");
      return;
    }
    const name = captureName.trim();
    if (!name) {
      message.warning("请填写方案名称");
      return;
    }
    setBusy(true);
    try {
      const captured = await schemesApi.captureCurrentScheme(adapterId, name);
      const saved = await schemesApi.saveScheme(captured);
      setCaptureOpen(false);
      setCaptureName("");
      await refreshSchemes();
      setSelectedId(saved.id);
      setBanner({
        level: "success",
        title: `已从「${adapter?.name ?? "当前网卡"}」保存方案「${saved.name}」`,
      });
    } catch (caught) {
      setCaptureOpen(false);
      setBanner({ level: "error", title: "读取当前网卡配置失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const startApply = async (scheme: Scheme) => {
    if (!adapterId) {
      message.warning("请先在主界面选择目标网卡");
      return;
    }
    setPlanTarget(scheme);
    setPlan(null);
    setPlanOpen(true);
    setPlanLoading(true);
    try {
      setPlan(await schemesApi.planScheme(scheme.id, adapterId));
    } catch (caught) {
      setPlanOpen(false);
      setPlan(null);
      setBanner({ level: "error", title: "无法生成变更预览", error: toAppError(caught) });
    } finally {
      setPlanLoading(false);
    }
  };

  const confirmApply = async () => {
    const target = planTarget;
    if (!target || !adapterId) return;
    setApplying(true);
    try {
      const result = await schemesApi.applyScheme(target.id, adapterId);
      const summary = describeApplyResult(result, `应用方案「${target.name}」`);
      setPlanOpen(false);
      setLastResult({ result, action: `应用方案「${target.name}」到「${plan?.adapterName ?? adapter?.name ?? ""}」` });
      setBanner({ level: summary.level, title: summary.title, message: summary.message });
      await Promise.all([refreshAdapters({ silent: true }), refreshSchemes()]);
    } catch (caught) {
      setPlanOpen(false);
      setBanner({ level: "error", title: "应用方案失败", error: toAppError(caught) });
    } finally {
      setApplying(false);
    }
  };

  const pickImportFile = async () => {
    if (!ensureNative("导入方案文件")) return;
    setBusy(true);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "方案文件", extensions: ["csv", "tsv", "xlsx", "xls", "json"] }],
      });
      if (typeof picked !== "string" || picked === "") return;
      const report = await schemesApi.importSchemes(picked);
      if (report.schemes.length > 0) {
        setImportChoice({ report, source: picked });
      } else {
        setImportOutcome({ report, source: picked, overwrite: false, imported: 0 });
        setBanner({
          level: report.errors.length > 0 ? "error" : "warning",
          title: "没有解析出可导入的方案",
          message: `跳过 ${report.skipped} 行，${report.errors.length} 行有错误`,
        });
      }
    } catch (caught) {
      setBanner({ level: "error", title: "导入方案失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const submitPaste = async () => {
    const text = pasteText.trim();
    if (!text) {
      message.warning("请先粘贴 CSV 文本");
      return;
    }
    setImportBusy(true);
    try {
      const report = await schemesApi.importSchemesText(text, "csv");
      setPasteOpen(false);
      setPasteText("");
      if (report.schemes.length > 0) {
        setImportChoice({ report, source: "粘贴的 CSV 文本" });
      } else {
        setImportOutcome({ report, source: "粘贴的 CSV 文本", overwrite: false, imported: 0 });
        setBanner({
          level: report.errors.length > 0 ? "error" : "warning",
          title: "没有解析出可导入的方案",
          message: `跳过 ${report.skipped} 行，${report.errors.length} 行有错误`,
        });
      }
    } catch (caught) {
      setPasteOpen(false);
      setBanner({ level: "error", title: "解析粘贴内容失败", error: toAppError(caught) });
    } finally {
      setImportBusy(false);
    }
  };

  const mergeImport = async (overwrite: boolean) => {
    const pending = importChoice;
    if (!pending) return;
    setImportBusy(true);
    try {
      await schemesApi.mergeSchemes(pending.report.schemes, overwrite);
      await refreshSchemes();
      setImportChoice(null);
      setImportOutcome({
        report: pending.report,
        source: pending.source,
        overwrite,
        imported: pending.report.schemes.length,
      });
      setBanner({
        level: pending.report.errors.length > 0 ? "warning" : "success",
        title: overwrite ? "已合并导入的方案" : "已仅新增导入的方案",
        message: `写入 ${pending.report.schemes.length} 条${
          overwrite ? "（同 ID 或同名方案已覆盖）" : "（同名方案已跳过）"
        }，跳过 ${pending.report.skipped} 行，${pending.report.errors.length} 行有错误`,
      });
    } catch (caught) {
      setBanner({ level: "error", title: "写入方案失败", error: toAppError(caught) });
    } finally {
      setImportBusy(false);
    }
  };

  const runExport = async (format: "csv" | "json") => {
    if (!ensureNative("导出方案")) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: format === "csv" ? "schemes.csv" : "schemes.json",
        filters: [
          { name: format === "csv" ? "CSV 文件" : "JSON 文件", extensions: [format] },
        ],
      });
      if (!path) return;
      const written = await schemesApi.exportSchemes(path, format);
      setBanner({ level: "success", title: `已导出 ${schemes.length} 个方案`, message: written });
    } catch (caught) {
      setBanner({ level: "error", title: "导出方案失败", error: toAppError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const copyLocation = async () => {
    if (!location) return;
    try {
      await navigator.clipboard.writeText(location);
      message.success("已复制方案文件路径");
    } catch (caught) {
      setBanner({ level: "error", title: "复制路径失败", error: toAppError(caught) });
    }
  };

  // F6 is handled by the shell: it dispatches the event instead of calling into here.
  const applySelectedRef = useRef<() => void>(() => {});
  applySelectedRef.current = () => {
    if (selectedScheme) {
      void startApply(selectedScheme);
      return;
    }
    message.warning("请先选中一个方案（单击列表行或左侧单选按钮）");
  };

  useEffect(() => {
    const handler = () => applySelectedRef.current();
    window.addEventListener(APPLY_SELECTED_SCHEME_EVENT, handler);
    return () => window.removeEventListener(APPLY_SELECTED_SCHEME_EVENT, handler);
  }, []);

  const rowMenuItems = (record: Scheme): MenuProps["items"] => {
    const index = schemes.findIndex((item) => item.id === record.id);
    return [
      { key: "rename", label: "重命名", icon: <EditOutlined /> },
      { key: "up", label: "上移", icon: <ArrowUpOutlined />, disabled: index <= 0 },
      {
        key: "down",
        label: "下移",
        icon: <ArrowDownOutlined />,
        disabled: index < 0 || index >= schemes.length - 1,
      },
      { type: "divider" },
      { key: "delete", label: "删除", icon: <DeleteOutlined />, danger: true },
    ];
  };

  const handleRowMenu = (key: string, record: Scheme) => {
    if (key === "rename") {
      setRenameValue(record.name);
      setRenameTarget(record);
      return;
    }
    if (key === "up") {
      void move(record, -1);
      return;
    }
    if (key === "down") {
      void move(record, 1);
      return;
    }
    if (key === "delete") setDeleteTarget(record);
  };

  const columns: TableProps<Scheme>["columns"] = [
    {
      title: "名称",
      key: "name",
      width: 220,
      render: (_value, record) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{record.name}</span>
          {record.id === selectedId ? (
            <Tag color="blue" style={{ alignSelf: "flex-start", marginInlineEnd: 0 }}>
              已选中
            </Tag>
          ) : null}
          {record.note ? <span className="kv__label">{record.note}</span> : null}
        </div>
      ),
    },
    {
      title: "标签",
      key: "tags",
      width: 140,
      render: (_value, record) =>
        record.tags.length > 0 ? (
          <div className="tag-row">
            {record.tags.map((tag) => (
              <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                {tag}
              </Tag>
            ))}
          </div>
        ) : (
          <span className="kv__label">—</span>
        ),
    },
    {
      title: "匹配规则",
      key: "match",
      width: 250,
      render: (_value, record) => (
        <SchemeMatchCell scheme={record} adapter={adapter} hostname={hostname} />
      ),
    },
    {
      title: "配置摘要",
      key: "summary",
      width: 280,
      render: (_value, record) => <SchemeSummaryCell scheme={record} />,
    },
    {
      title: "更新时间",
      key: "updatedAtMs",
      width: 140,
      render: (_value, record) => (
        <span className="cell-mono">{formatTimestamp(record.updatedAtMs)}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 250,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={!adapterId || working}
            onClick={() => void startApply(record)}
          >
            应用
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={working}
            onClick={() => openEditor(record)}
          >
            编辑
          </Button>
          <Tooltip title="复制为副本（另存为新方案）">
            <Button
              size="small"
              icon={<CopyOutlined />}
              aria-label={`复制方案 ${record.name} 为副本`}
              disabled={working}
              onClick={() => openEditor(duplicateScheme(record))}
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            disabled={working}
            menu={{ items: rowMenuItems(record), onClick: ({ key }) => handleRowMenu(key, record) }}
          >
            <Button
              size="small"
              icon={<MoreOutlined />}
              aria-label={`更多操作：${record.name}`}
              disabled={working}
            >
              更多
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ];

  const newItems: MenuProps["items"] = [
    { key: "blank", label: "空白方案", icon: <PlusOutlined /> },
    {
      key: "capture",
      label: "从当前网卡读取",
      icon: <SaveOutlined />,
      disabled: !adapterId,
    },
  ];

  const importItems: MenuProps["items"] = [
    { key: "file", label: "选择文件（CSV / Excel / JSON）", icon: <UploadOutlined /> },
    { key: "paste", label: "粘贴 CSV 文本导入", icon: <FileTextOutlined /> },
  ];

  const exportItems: MenuProps["items"] = [
    { key: "csv", label: "导出为 CSV", icon: <DownloadOutlined />, disabled: schemes.length === 0 },
    { key: "json", label: "导出为 JSON", icon: <DownloadOutlined />, disabled: schemes.length === 0 },
  ];

  const handleNewMenu = (key: string) => {
    if (key === "blank") {
      openEditor(blankScheme());
      return;
    }
    if (key === "capture") {
      if (!ensureNative("读取当前网卡配置")) return;
      if (!adapterId) {
        message.warning("请先在主界面选择目标网卡");
        return;
      }
      setCaptureName("");
      setCaptureOpen(true);
    }
  };

  const handleImportMenu = (key: string) => {
    if (key === "file") {
      void pickImportFile();
      return;
    }
    if (key === "paste") {
      if (!ensureNative("粘贴 CSV 文本导入")) return;
      setPasteText("");
      setPasteOpen(true);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">方案管理</h1>
          <p className="page-head__desc">
            保存常用网络配置，一键应用到当前网卡；支持 CSV / TSV / Excel / JSON 导入导出。
          </p>
        </div>
        <div className="page-head__actions">
          <Dropdown menu={{ items: newItems, onClick: ({ key }) => handleNewMenu(key) }}>
            <Button type="primary" icon={<PlusOutlined />} disabled={working}>
              新建方案
            </Button>
          </Dropdown>
          <Dropdown menu={{ items: importItems, onClick: ({ key }) => handleImportMenu(key) }}>
            <Button icon={<UploadOutlined />} disabled={working}>
              导入
            </Button>
          </Dropdown>
          <Dropdown
            menu={{ items: exportItems, onClick: ({ key }) => void runExport(key === "json" ? "json" : "csv") }}
          >
            <Button icon={<DownloadOutlined />} disabled={working}>
              导出
            </Button>
          </Dropdown>
          <Tooltip title="重新读取方案列表">
            <Button
              icon={<ReloadOutlined />}
              aria-label="刷新方案列表"
              loading={schemesLoading}
              onClick={() => void refreshSchemes()}
            />
          </Tooltip>
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
        title="方案列表"
        hint={
          adapter
            ? `目标网卡：${adapter.name}（${adapter.mac}）`
            : "未选择网卡，应用前请先在主界面选择网卡"
        }
        extra={
          <Space>
            <span className="kv__label">
              {selectedScheme ? `已选中：${selectedScheme.name}` : "未选择方案"}
            </span>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              disabled={!selectedScheme || !adapterId || working}
              onClick={() => {
                if (selectedScheme) void startApply(selectedScheme);
              }}
            >
              应用选中方案
            </Button>
            <span className="kbd">F6</span>
          </Space>
        }
      >
        {phase === "loading" ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Spin />
            <div className="kv__label" style={{ marginTop: 8 }}>
              正在读取方案…
            </div>
          </div>
        ) : phase === "empty" ? (
          <div className="empty-state">
            <div className="empty-state__title">还没有任何方案</div>
            <p>
              可以把当前网卡的配置保存为新方案，也可以导入之前导出的 CSV / Excel / JSON 文件。
              保存后双击列表行或按 F6 即可一键应用。
            </p>
            <Space wrap>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!adapterId || working}
                onClick={() => {
                  if (!ensureNative("读取当前网卡配置")) return;
                  setCaptureName("");
                  setCaptureOpen(true);
                }}
              >
                从当前网卡保存为方案
              </Button>
              <Button icon={<PlusOutlined />} disabled={working} onClick={() => openEditor(blankScheme())}>
                新建空白方案
              </Button>
              <Button icon={<UploadOutlined />} disabled={working} onClick={() => void pickImportFile()}>
                从文件导入
              </Button>
            </Space>
          </div>
        ) : (
          <Table<Scheme>
            size="small"
            rowKey="id"
            dataSource={schemes}
            columns={columns}
            pagination={false}
            scroll={{ x: 1200 }}
            rowSelection={{
              type: "radio",
              columnTitle: "选择",
              columnWidth: 40,
              selectedRowKeys: selectedId ? [selectedId] : [],
              onChange: (keys) => setSelectedId(typeof keys[0] === "string" ? keys[0] : ""),
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id),
              onDoubleClick: (event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button, a, input, .ant-dropdown")) return;
                setSelectedId(record.id);
                void startApply(record);
              },
              "aria-selected": record.id === selectedId,
            })}
          />
        )}
      </SectionCard>

      {lastResult ? (
        <SectionCard
          title="最近一次应用结果"
          extra={
            <Button size="small" onClick={() => setLastResult(null)}>
              清除
            </Button>
          }
        >
          <ApplyResultPanel result={lastResult.result} action={lastResult.action} />
        </SectionCard>
      ) : null}

      {importOutcome ? (
        <SectionCard
          title="最近一次导入结果"
          hint={importOutcome.source}
          extra={
            <Button size="small" onClick={() => setImportOutcome(null)}>
              清除
            </Button>
          }
        >
          <div className="tag-row">
            <Tag color="green">解析成功 {importOutcome.report.schemes.length} 条</Tag>
            <Tag color={importOutcome.report.errors.length > 0 ? "red" : "default"}>
              错误 {importOutcome.report.errors.length} 行
            </Tag>
            <Tag>跳过 {importOutcome.report.skipped} 行</Tag>
            {importOutcome.imported > 0 ? (
              <Tag color="blue">
                已写入 {importOutcome.imported} 条
                {importOutcome.overwrite ? "（同 ID / 同名覆盖）" : "（仅新增）"}
              </Tag>
            ) : null}
          </div>
          {importOutcome.report.errors.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Collapse
                ghost
                items={[
                  {
                    key: "errors",
                    label: `逐行错误（${importOutcome.report.errors.length}）`,
                    children: (
                      <div className="scroll-pane scroll-pane--fit">
                        <ul className="plan-list">
                          {importOutcome.report.errors.map((item) => (
                            <li className="plan-row" key={item}>
                              <span className="plan-row__label">错误</span>
                              <span className="plan-row__change cell-mono">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="方案文件位置" hint="方案保存在本机，可在程序之间复制">
        <div className="kv-grid">
          <div className="kv">
            <span className="kv__label">方案文件</span>
            <span className="kv__value kv__value--mono">{location ?? "读取中…"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">目标网卡</span>
            <span className="kv__value">{adapter ? adapter.name : "未选择"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">当前主机名</span>
            <span className="kv__value kv__value--mono">{hostname ?? "—"}</span>
          </div>
        </div>
        <Space style={{ marginTop: 12 }}>
          <Button size="small" disabled={!location} onClick={() => void copyLocation()}>
            复制文件路径
          </Button>
          <Button size="small" onClick={() => void refreshSchemes()}>
            重新读取方案
          </Button>
        </Space>
      </SectionCard>

      <SchemeEditorModal
        open={editorOpen}
        scheme={editorScheme}
        adapter={adapter}
        hostname={hostname}
        saving={busy}
        error={editorError}
        onCancel={() => {
          setEditorOpen(false);
          setEditorScheme(null);
          setEditorError(null);
        }}
        onSubmit={(next) => void saveEditor(next)}
      />

      <Modal
        open={!!renameTarget}
        title="重命名方案"
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        onOk={() => void confirmRename()}
        onCancel={() => setRenameTarget(null)}
      >
        <Input
          value={renameValue}
          aria-label="新的方案名称"
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void confirmRename()}
        />
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="删除方案"
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      >
        <Typography.Text>
          删除后无法撤销，确定要删除方案「{deleteTarget?.name ?? ""}」吗？
        </Typography.Text>
      </Modal>

      <Modal
        open={captureOpen}
        title="从当前网卡保存为方案"
        okText="读取并保存"
        cancelText="取消"
        confirmLoading={busy}
        onOk={() => void confirmCapture()}
        onCancel={() => setCaptureOpen(false)}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            将读取「{adapter?.name ?? "当前网卡"}」现有的 IP / 掩码 / 网关 / DNS / 跃点数，并把 MAC、
            主机名与网卡名写入匹配规则。
          </Typography.Text>
          <Input
            value={captureName}
            aria-label="方案名称"
            placeholder="例如：办公室"
            onChange={(event) => setCaptureName(event.target.value)}
            onPressEnter={() => void confirmCapture()}
          />
        </Space>
      </Modal>

      <Modal
        open={pasteOpen}
        title="粘贴 CSV 文本导入"
        okText="解析"
        cancelText="取消"
        width={680}
        confirmLoading={importBusy}
        onOk={() => void submitPaste()}
        onCancel={() => setPasteOpen(false)}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            第一行必须是表头。可用列名：name/名称、tags/标签、matchMac/匹配MAC、dhcp/自动获取、
            addresses/地址、masks/掩码、gateway/网关、dns/DNS服务器、metric/跃点、note/备注；
            多个地址或 DNS 用竖线或分号分隔。
          </Typography.Text>
          <Input.TextArea
            value={pasteText}
            aria-label="CSV 文本"
            className="mono"
            rows={10}
            style={{ fontSize: 12 }}
            placeholder={"name,dhcp,addresses,masks,gateway,dns\n办公室,false,10.30.1.237,255.255.252.0,10.30.0.11,223.5.5.5"}
            onChange={(event) => setPasteText(event.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        open={!!importChoice}
        title="导入方案"
        maskClosable={!importBusy}
        onCancel={() => {
          if (!importBusy) setImportChoice(null);
        }}
        footer={
          <Space>
            <Button disabled={importBusy} onClick={() => setImportChoice(null)}>
              取消
            </Button>
            <Button loading={importBusy} onClick={() => void mergeImport(false)}>
              仅新增
            </Button>
            <Button type="primary" loading={importBusy} onClick={() => void mergeImport(true)}>
              合并（覆盖同 ID / 同名）
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="tag-row">
            <Tag color="green">解析成功 {importChoice?.report.schemes.length ?? 0} 条</Tag>
            <Tag color={(importChoice?.report.errors.length ?? 0) > 0 ? "red" : "default"}>
              错误 {importChoice?.report.errors.length ?? 0} 行
            </Tag>
            <Tag>跳过 {importChoice?.report.skipped ?? 0} 行</Tag>
          </div>
          <Typography.Text type="secondary">
            选择「合并」会用文件中的方案覆盖同 ID 或同名的方案；选择「仅新增」会跳过已存在的方案。
            来源：{importChoice?.source ?? ""}
          </Typography.Text>
          {importChoice && importChoice.report.errors.length > 0 ? (
            <div className="scroll-pane scroll-pane--fit">
              <ul className="plan-list">
                {importChoice.report.errors.map((item) => (
                  <li className="plan-row" key={item}>
                    <span className="plan-row__label">错误</span>
                    <span className="plan-row__change cell-mono">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Space>
      </Modal>

      <ConfirmApplyDialog
        open={planOpen}
        plan={plan}
        loadingPlan={planLoading}
        applying={applying}
        title={planTarget ? `确认应用方案「${planTarget.name}」` : "确认应用方案"}
        confirmText="确认写入"
        onCancel={() => {
          if (applying) return;
          setPlanOpen(false);
          setPlan(null);
        }}
        onConfirm={() => void confirmApply()}
      />
    </div>
  );
}
