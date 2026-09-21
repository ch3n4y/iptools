import { call, desktopOnly, isNative } from "./native";
import { mockIdentity } from "./mock";
import type { IdentityInfo } from "../types";

export async function getIdentity(): Promise<IdentityInfo> {
  if (!isNative()) return mockIdentity;
  return call<IdentityInfo>("get_identity");
}

export async function isElevated(): Promise<boolean> {
  if (!isNative()) return false;
  return call<boolean>("is_elevated");
}

export async function relaunchAsAdmin(): Promise<void> {
  if (!isNative()) throw desktopOnly("以管理员身份重启");
  await call<void>("relaunch_as_admin");
}

export async function openNetworkConnections(): Promise<void> {
  if (!isNative()) throw desktopOnly("打开网络连接");
  await call<void>("open_network_connections");
}

export async function openAppLocation(): Promise<string> {
  if (!isNative()) return "%APPDATA%\\iptools";
  return call<string>("open_app_location");
}
