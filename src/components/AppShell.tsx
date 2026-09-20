import { NAV_GROUPS, VIEW_META, useAppStore, type ViewKey } from "../state/store";
import { useAdapterPolling } from "../hooks/useAdapterPolling";
import ElevationBanner from "./ElevationBanner";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import AdvancedView from "../features/advanced/AdvancedView";
import HelpView from "../features/help/HelpView";
import HomeView from "../features/home/HomeView";
import IdentityView from "../features/identity/IdentityView";
import PingScannerView from "../features/toolbox/PingScannerView";
import SchemesView from "../features/schemes/SchemesView";
import SettingsView from "../features/settings/SettingsView";
import SubnetCalculatorView from "../features/toolbox/SubnetCalculatorView";

const VIEWS: Record<ViewKey, () => React.ReactElement> = {
  home: HomeView,
  identity: IdentityView,
  schemes: SchemesView,
  advanced: AdvancedView,
  ping: PingScannerView,
  subnet: SubnetCalculatorView,
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
          {NAV_GROUPS.map((group) => (
            <div key={group.group}>
              <div className="rail__group-title">{group.group}</div>
              {group.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rail__item"
                  aria-current={view === item ? "page" : undefined}
                  onClick={() => setView(item)}
                >
                  <span>{VIEW_META[item].label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="rail__spacer" />
          <div className="rail__foot">
            修改前请确认目标网卡；写入后会读回校验并在失败时自动回滚。
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
