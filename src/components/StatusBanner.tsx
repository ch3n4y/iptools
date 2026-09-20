import { Alert, Button, Collapse, Space, Typography } from "antd";
import { errorSummary, type AppError } from "../lib/errors";

type Level = "info" | "success" | "warning" | "error";

interface Props {
  level: Level;
  title: string;
  message?: string | null;
  error?: AppError | null;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>;
  onDismiss?: () => void;
}

/** Result banner with the raw diagnostics kept behind a disclosure. */
export default function StatusBanner({ level, title, message, error, actions, onDismiss }: Props) {
  const detail = error
    ? [error.detail, error.hint].filter(Boolean).join("\n")
    : undefined;

  return (
    <Alert
      type={level === "error" ? "error" : level}
      showIcon
      role={level === "error" ? "alert" : "status"}
      message={title}
      description={
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          {message ? <Typography.Text>{message}</Typography.Text> : null}
          {error ? (
            <Typography.Text type="secondary">{errorSummary(error)}</Typography.Text>
          ) : null}
          {detail ? (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "detail",
                  label: "技术详情",
                  children: (
                    <Typography.Paragraph
                      className="mono"
                      style={{ whiteSpace: "pre-wrap", fontSize: 12, marginBottom: 0 }}
                    >
                      {`错误码：${error?.code ?? "-"}\n${detail}`}
                    </Typography.Paragraph>
                  ),
                },
              ]}
            />
          ) : null}
          {actions?.length ? (
            <Space>
              {actions.map((action) => (
                <Button
                  key={action.label}
                  size="small"
                  type={action.primary ? "primary" : "default"}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </Space>
          ) : null}
        </Space>
      }
      closable={!!onDismiss}
      onClose={onDismiss}
      style={{ marginBottom: 16 }}
    />
  );
}
