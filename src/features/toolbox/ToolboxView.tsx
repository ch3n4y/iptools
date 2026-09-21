import { Segmented } from "antd";
import { useEffect, useState } from "react";
import PingScannerView from "./PingScannerView";
import SubnetCalculatorView from "./SubnetCalculatorView";

type Tool = "scan" | "mask";

/**
 * Toolbox: the subnet calculator and the C-segment scanner share one page
 * because they are two halves of the same job (pick a range, then look at who
 * answers). The calculator can hand its range straight to the scanner.
 */
export default function ToolboxView() {
  const [tool, setTool] = useState<Tool>("scan");

  useEffect(() => {
    const handler = () => setTool("scan");
    window.addEventListener("iptools:scan-spec", handler);
    return () => window.removeEventListener("iptools:scan-spec", handler);
  }, []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Segmented
          value={tool}
          onChange={(value) => setTool(value as Tool)}
          aria-label="工具箱应用"
          options={[
            { value: "scan", label: "网络扫描" },
            { value: "mask", label: "掩码计算" },
          ]}
        />
      </div>
      {tool === "scan" ? <PingScannerView /> : <SubnetCalculatorView />}
    </>
  );
}
