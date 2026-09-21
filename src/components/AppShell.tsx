import { VIEW_META, VIEW_ORDER, useAppStore, type ViewKey } from "../state/store";
import { useAdapterPolling } from "../hooks/useAdapterPolling";
import ElevationBanner from "./ElevationBanner";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import HelpView from "../features/help/HelpView";
import HomeView from "../features/home/HomeView";
import SchemesView from "../features/schemes/SchemesView";
import SettingsView from "../features/settings/SettingsView";
import ToolboxView from "../features/toolbox/ToolboxView";

const VIEWS: Record<ViewKey, () => React.ReactElement> = {
  home: HomeView,
  schemes: SchemesView,
  toolbox: ToolboxView,
  settings: SettingsView,
  help: HelpView,
};

export default function AppShell() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);

  useAdapterPolling();

  const View = VIEWS[view] ?? HomeView;

  return (
    <div className="app-root">
      <TitleBar />
      <div className="shell">
        <nav className="rail" aria-label="主导航">
          {VIEW_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className="rail__item"
              aria-current={view === item ? "page" : undefined}
              title={VIEW_META[item].desc}
              onClick={() => setView(item)}
            >
              <span>{VIEW_META[item].label}</span>
            </button>
          ))}
          <div className="rail__spacer" />
          <div className="rail__foot">
            写入前请确认目标网卡；写入后会读回校验，失败时自动回滚。
          </div>
        </nav>
        <main className="content">
          <div className="content__inner">
            <ElevationBanner />
            <div className="view-enter" key={view}>
              <View />
            </div>
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
