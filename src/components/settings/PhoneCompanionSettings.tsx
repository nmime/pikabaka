import React, { useCallback, useEffect, useState } from "react";
import {
  Smartphone,
  QrCode,
  RefreshCw,
  Power,
  Trash2,
  Wifi,
  ShieldCheck,
  Edit3,
  Save,
} from "lucide-react";

interface CompanionDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number;
  remoteAddress?: string;
  nickname?: string;
  role: "controller" | "viewer" | "uploader";
  createdAt: number;
  connected?: boolean;
}

interface CompanionPairing {
  token?: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
}

interface CompanionStatus {
  running: boolean;
  port: number | null;
  urls: string[];
  activeConnections: number;
  pairedDevices: CompanionDevice[];
  pairing?: CompanionPairing | null;
  settings: { autoStart: boolean; preferredPort: number };
}

const formatTime = (value?: number) => {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
};

export const PhoneCompanionSettings: React.FC = () => {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferredPort, setPreferredPort] = useState("0");

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI?.companionGetStatus?.();
      if (next) {
        setStatus(next);
        setPreferredPort(String(next.settings?.preferredPort || 0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.electronAPI?.onCompanionStatusChanged?.(
      (next: CompanionStatus) => setStatus(next),
    );
    return () => unsubscribe?.();
  }, [refresh]);

  const run = async (fn: () => Promise<CompanionStatus | undefined>) => {
    setIsBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) {
        setStatus(next);
        setPreferredPort(String(next.settings?.preferredPort || 0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const start = () => run(() => window.electronAPI?.companionStart?.());
  const stop = () => run(() => window.electronAPI?.companionStop?.());
  const createPairing = () =>
    run(() => window.electronAPI?.companionCreatePairingCode?.());
  const revoke = (deviceId: string) =>
    run(() => window.electronAPI?.companionRevokeDevice?.(deviceId));
  const updateSettings = (
    patch: Partial<{ autoStart: boolean; preferredPort: number }>,
  ) => run(() => window.electronAPI?.companionUpdateSettings?.(patch));
  const updateDevice = (
    device: CompanionDevice,
    patch: Partial<Pick<CompanionDevice, "nickname" | "role" | "name">>,
  ) => run(() => window.electronAPI?.companionUpdateDevice?.(device.id, patch));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">
          <Smartphone size={18} /> Phone Companion
        </h3>
        <p className="text-sm text-text-secondary">
          Pair your phone over the local network to mirror live transcripts and
          AI answers, send files/photos into context, and trigger Pika actions
          without a cloud account.
        </p>
      </div>

      <div className="p-4 rounded-xl border border-border-subtle bg-bg-secondary/60 space-y-3">
        <div className="text-sm font-semibold text-text-primary">
          Persistent companion settings
        </div>
        <label className="flex items-center justify-between gap-3 text-sm text-text-primary">
          <span>Auto-start phone companion on app launch</span>
          <input
            type="checkbox"
            checked={!!status?.settings?.autoStart}
            onChange={(event) =>
              updateSettings({ autoStart: event.target.checked })
            }
            disabled={isBusy}
            className="w-4 h-4"
          />
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={0}
            max={65535}
            value={preferredPort}
            onChange={(event) => setPreferredPort(event.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-bg-item-hover border border-border-subtle text-text-primary text-sm"
            placeholder="Preferred port (0 = automatic)"
          />
          <button
            type="button"
            onClick={() =>
              updateSettings({ preferredPort: Number(preferredPort) || 0 })
            }
            disabled={isBusy}
            className="px-3 py-2 rounded-lg bg-bg-item-hover text-text-primary border border-border-subtle hover:bg-bg-item-active transition-colors text-sm flex items-center gap-2"
          >
            <Save size={14} /> Save
          </button>
        </div>
        <div className="text-xs text-text-tertiary">
          Trusted device tokens are stored only as hashes; revoking a phone
          immediately disconnects active sockets and blocks reconnect.
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border-subtle bg-bg-secondary/60 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Wifi
                size={16}
                className={
                  status?.running ? "text-emerald-400" : "text-text-tertiary"
                }
              />
              {status?.running
                ? "Companion server running"
                : "Companion server stopped"}
            </div>
            <div className="text-xs text-text-secondary mt-1">
              {status?.running
                ? `${status.activeConnections} phone connection${status.activeConnections === 1 ? "" : "s"} · port ${status.port}`
                : "Start the server to create a QR pairing code."}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={status?.running ? stop : start}
              disabled={isBusy}
              className="px-3 py-2 rounded-lg bg-bg-item-hover text-text-primary border border-border-subtle hover:bg-bg-item-active transition-colors text-sm flex items-center gap-2"
            >
              <Power size={14} /> {status?.running ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={isBusy}
              className="px-3 py-2 rounded-lg bg-bg-item-hover text-text-primary border border-border-subtle hover:bg-bg-item-active transition-colors text-sm flex items-center gap-2"
            >
              <RefreshCw size={14} className={isBusy ? "animate-spin" : ""} />{" "}
              Refresh
            </button>
          </div>
        </div>

        {status?.urls?.length ? (
          <div className="text-xs text-text-tertiary space-y-1">
            {status.urls.map((url) => (
              <div key={url} className="font-mono truncate">
                {url}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="p-4 rounded-xl border border-border-subtle bg-bg-secondary/60 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <QrCode size={16} /> Pair a phone
            </div>
            <div className="text-xs text-text-secondary mt-1">
              QR tokens expire after five minutes and can be regenerated any
              time.
            </div>
          </div>
          <button
            type="button"
            onClick={createPairing}
            disabled={isBusy}
            className="px-3 py-2 rounded-lg bg-primary/80 text-white hover:bg-primary transition-colors text-sm"
          >
            {status?.pairing ? "Regenerate QR" : "Create QR code"}
          </button>
        </div>

        {status?.pairing ? (
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img
              src={status.pairing.qrDataUrl}
              alt="Phone companion QR code"
              className="w-44 h-44 rounded-xl bg-white p-2"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-xs text-text-secondary">
                Open this URL on your phone if scanning is unavailable:
              </div>
              <div className="text-xs font-mono break-all p-2 rounded-lg bg-bg-item-hover border border-border-subtle">
                {status.pairing.url}
              </div>
              <div className="text-xs text-text-tertiary">
                Expires {formatTime(status.pairing.expiresAt)}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">
            No active pairing code.
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl border border-border-subtle bg-bg-secondary/60 space-y-3">
        <div className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <ShieldCheck size={16} /> Trusted web devices
        </div>
        {status?.pairedDevices?.length ? (
          <div className="space-y-2">
            {status.pairedDevices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-bg-item-hover/60 border border-border-subtle"
              >
                <div className="min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {device.name}
                  </div>
                  <div className="text-xs text-text-tertiary truncate">
                    Last seen {formatTime(device.lastSeenAt)}{" "}
                    {device.remoteAddress ? `· ${device.remoteAddress}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(device.id)}
                  className="p-2 rounded-lg text-text-secondary hover:text-state-danger hover:bg-bg-item-active transition-colors"
                  title="Revoke device"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">
            No paired phones yet.
          </div>
        )}
      </div>

      {error ? <div className="text-sm text-state-danger">{error}</div> : null}
    </div>
  );
};

export default PhoneCompanionSettings;
