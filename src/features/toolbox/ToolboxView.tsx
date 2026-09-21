import { Segmented } from "antd";
import { useAppStore } from "../../state/store";
import PingScannerView from "./PingScannerView";
import SubnetCalculatorView from "./SubnetCalculatorView";

/**
 * 工具箱：网络扫描与掩码计算是同一件事的两半（先定网段，再看谁在线），
 * 所以合成一页，用 Segmented 切换。
 *
 * 当前工具页与「掩码计算交给扫描的网段」都放在 store 里：扫描页是懒挂载的，
 * 用 window 事件传递会丢失（事件在扫描页挂载前就派发完了）。
 */
export default function ToolboxView() {
  const tool = useAppStore((state) => state.toolboxTool);
  const setTool = useAppStore((state) => state.setToolboxTool);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Segmented
          value={tool}
          onChange={(value) => setTool(value as typeof tool)}
          aria-label="工具箱应用"
          options={[
            { value: "scan", label: "网络扫描" },
            { value: "mask", label: "掩码计算" },
          ]}
        />
      </div>
      {/* 两个工具页都保持挂载：切换时不会丢掉用户已经展开的扫描目标与结果 */}
      <div hidden={tool !== "scan"}>
        <PingScannerView />
      </div>
      <div hidden={tool !== "mask"}>
        <SubnetCalculatorView />
      </div>
    </>
  );
}
