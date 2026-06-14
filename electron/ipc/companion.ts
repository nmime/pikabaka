import { AppState } from "../main";
import { SettingsManager } from "../services/SettingsManager";
import { safeHandle } from "./safeHandle";

function normalizeCompanionSettings(input: any) {
  return {
    autoStart: Boolean(input?.autoStart),
    preferredPort: Number.isFinite(Number(input?.preferredPort))
      ? Math.trunc(Number(input.preferredPort))
      : 0,
  };
}

export function registerCompanionHandlers(appState: AppState): void {
  safeHandle("companion:get-status", async () =>
    appState.getCompanionServer().getStatus(),
  );

  safeHandle("companion:start", async (_, preferredPort?: number) => {
    return appState.getCompanionServer().start(preferredPort || 0);
  });

  safeHandle("companion:stop", async () =>
    appState.getCompanionServer().stop(),
  );

  safeHandle("companion:create-pairing-code", async () => {
    return appState.getCompanionServer().createPairingCode();
  });

  safeHandle("companion:revoke-device", async (_, deviceId: string) => {
    return appState.getCompanionServer().revokeDevice(deviceId);
  });

  safeHandle(
    "companion:update-device",
    async (_, deviceId: string, patch: any) => {
      return appState
        .getCompanionServer()
        .updateDeviceMetadata(deviceId, patch || {});
    },
  );

  safeHandle("companion:get-settings", async () => {
    return appState.getCompanionServer().getStatus().settings;
  });

  safeHandle("companion:update-settings", async (_, patch: any) => {
    const settingsManager = SettingsManager.getInstance();
    const current = appState.getCompanionServer().getStatus().settings;
    const next = normalizeCompanionSettings({ ...current, ...(patch || {}) });
    settingsManager.set("companion", next);
    if (next.autoStart && !appState.getCompanionServer().getStatus().running) {
      return appState.getCompanionServer().start(next.preferredPort || 0);
    }
    return appState.getCompanionServer().getStatus();
  });

  safeHandle("companion:update-snapshot", async (_, snapshot: any) => {
    return appState.getCompanionServer().updateSnapshot(snapshot || {});
  });
}
