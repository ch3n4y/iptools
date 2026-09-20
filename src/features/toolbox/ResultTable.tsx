import type { ReactNode } from "react";
import { Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { rttClass } from "../../lib/format";
import type { PingResult } from "../../lib/types";

interface Props {
  rows: PingResult[];
  /** Rendered when the (filtered) table has no rows. */
  emptyText: ReactNode;
}

function nullsLast(
  pick: (row: PingResult) => number | null,
): (a: PingResult, b: PingResult) => number {
  return (a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  };
}

function rttCell(row: PingResult, value: number | null) {
  return (
    <span className={`rtt-cell ${rttClass(value, row.alive)}`}>
      {value === null ? "—" : value}
    </span>
  );
}

const columns: TableColumnsType<PingResult> = [
  {
    title: "地址",
    dataIndex: "target",
    key: "target",
    width: 190,
    sorter: (a, b) => a.target.localeCompare(b.target, "zh-Hans-CN", { numeric: true }),
    render: (_value, row) => (
      <span className="cell-mono">
        {row.target}
        {row.isLocal ? (
          <Tag color="blue" style={{ marginLeft: 6 }}>
            本机
          </Tag>
        ) : null}
      </span>
    ),
  },
  {
    title: "状态",
    dataIndex: "alive",
    key: "alive",
    width: 100,
    sorter: (a, b) => Number(a.alive) - Number(b.alive),
    render: (_value, row) =>
      row.alive ? (
        <Tag color="success">在线</Tag>
      ) : (
        <Tag color="error">无响应</Tag>
      ),
  },
  {
    title: "最小延时 (ms)",
    dataIndex: "rttMs",
    key: "rttMs",
    width: 128,
    sorter: nullsLast((row) => row.rttMs),
    render: (_value, row) => rttCell(row, row.rttMs),
  },
  {
    title: "最大延时 (ms)",
    dataIndex: "rttMaxMs",
    key: "rttMaxMs",
    width: 128,
    sorter: nullsLast((row) => row.rttMaxMs),
    render: (_value, row) => rttCell(row, row.rttMaxMs),
  },
  {
    title: "丢包 (丢失/发送)",
    key: "loss",
    width: 140,
    sorter: (a, b) =>
      a.sent - a.received - (b.sent - b.received),
    render: (_value, row) => {
      const lost = Math.max(0, row.sent - row.received);
      const text = `${lost}/${row.sent}`;
      return row.sent === 0 ? (
        <span className="cell-mono">—</span>
      ) : (
        <span className={`cell-mono ${lost > 0 ? "rtt--slow" : "rtt--fast"}`}>{text}</span>
      );
    },
  },
  {
    title: "MAC 地址",
    dataIndex: "mac",
    key: "mac",
    width: 160,
    render: (_value, row) =>
      row.mac ? <span className="cell-mono">{row.mac}</span> : <span className="cell-mono">—</span>,
  },
  {
    title: "说明",
    dataIndex: "error",
    key: "error",
    ellipsis: true,
    render: (_value, row) =>
      row.error ? (
        <Tooltip title={row.error}>
          <span>{row.error}</span>
        </Tooltip>
      ) : (
        <span>—</span>
      ),
  },
];

/**
 * Presentational result table for the C-segment ping scanner.
 * Filtering/sorting are handled by antd; the parent owns the row list.
 */
export default function ResultTable({ rows, emptyText }: Props) {
  return (
    <Table<PingResult>
      size="small"
      columns={columns}
      dataSource={rows}
      rowKey="target"
      pagination={false}
      scroll={{ y: 380, x: 1000 }}
      rowClassName={(row) => (row.isLocal ? "row--local" : "")}
      locale={{ emptyText }}
    />
  );
}
