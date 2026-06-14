import http, { IncomingMessage, ServerResponse } from "http";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AddressInfo } from "net";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";

export interface CompanionTranscriptSegment {
  segmentId?: string;
  speakerLabel?: string;
  speaker?: string;
  text: string;
  sourceText?: string;
  translatedText?: string;
  final?: boolean;
  timestamp?: number;
}

export interface CompanionChatMessage {
  id: string;
  role: string;
  text: string;
  isStreaming?: boolean;
  streamStatus?: string;
  intent?: string;
}

export interface CompanionSnapshot {
  updatedAt: number;
  transcriptSegments: CompanionTranscriptSegment[];
  currentInterviewerPartial?: string;
  messages: CompanionChatMessage[];
  currentModel?: string;
  provider?: string;
  providerName?: string;
  audioHealth?: any;
  meetingActive?: boolean;
}

export type CompanionCommandType =
  | "ask"
  | "clarify"
  | "recap"
  | "brainstorm"
  | "what_to_answer"
  | "follow_up"
  | "code_hint"
  | "attach-file"
  | "reset_cancel"
  | "toggle_visibility"
  | "mouse_passthrough"
  | "screenshot"
  | "selective_screenshot"
  | "ping";

export interface CompanionCommand {
  id: string;
  type: CompanionCommandType;
  payload?: any;
  receivedAt: number;
  deviceId?: string;
}

export type CompanionDeviceRole = "controller" | "viewer" | "uploader";

export interface CompanionDevice {
  id: string;
  name: string;
  nickname?: string;
  role: CompanionDeviceRole;
  pairedAt: number;
  createdAt: number;
  lastSeenAt: number;
  userAgent?: string;
  remoteAddress?: string;
  connected?: boolean;
  revokedAt?: number;
}

interface StoredCompanionDevice extends CompanionDevice {
  tokenHash: string;
}

export interface CompanionPairing {
  url: string;
  qrDataUrl: string;
  expiresAt: number;
  token?: string;
}

export interface CompanionSettings {
  autoStart: boolean;
  preferredPort: number;
}

export interface CompanionStatus {
  running: boolean;
  port: number | null;
  urls: string[];
  activeConnections: number;
  pairedDevices: CompanionDevice[];
  pairing?: CompanionPairing | null;
  settings: CompanionSettings;
}

interface CompanionServerOptions {
  userDataDir: string;
  onCommand?: (command: CompanionCommand) => void;
  onStatusChanged?: (status: CompanionStatus) => void;
  getSettings?: () => Partial<CompanionSettings> | undefined;
}

type JsonObject = Record<string, any>;

type AuthResult = {
  ok: boolean;
  deviceId?: string;
  credential?: string;
  paired?: boolean;
  error?: string;
};

type RateBucket = { count: number; resetAt: number };

type SocketState = { deviceId: string; alive: boolean; connectedAt: number };

const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const TRUSTED_DEVICES_FILE = "phone-companion-devices.json";
const DEFAULT_SETTINGS: CompanionSettings = {
  autoStart: false,
  preferredPort: 0,
};

const ALLOWED_COMMANDS = new Set<CompanionCommandType>([
  "ask",
  "clarify",
  "recap",
  "brainstorm",
  "what_to_answer",
  "follow_up",
  "code_hint",
  "attach-file",
  "reset_cancel",
  "toggle_visibility",
  "mouse_passthrough",
  "screenshot",
  "selective_screenshot",
  "ping",
]);

export class CompanionServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number | null = null;
  private pairing: (CompanionPairing & { tokenHash: string }) | null = null;
  private devices = new Map<string, StoredCompanionDevice>();
  private sockets = new Map<WebSocket, SocketState>();
  private rateBuckets = new Map<string, RateBucket>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private snapshot: CompanionSnapshot = {
    updatedAt: Date.now(),
    transcriptSegments: [],
    messages: [],
  };

  constructor(private options: CompanionServerOptions) {
    this.loadTrustedDevices();
  }

  public async start(preferredPort = 0): Promise<CompanionStatus> {
    if (this.server) return this.getStatus();

    const port = this.normalizePort(
      preferredPort || this.getSettings().preferredPort,
    );
    this.server = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        console.error(
          "[CompanionServer] HTTP error:",
          error instanceof Error ? error.message : String(error),
        );
        if (!res.headersSent)
          this.sendJson(res, 500, { error: "Internal server error" });
      });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const auth = (req as any).companionAuth as AuthResult | undefined;
      this.handleSocket(
        socket,
        req,
        auth?.deviceId || "unknown",
        auth?.credential,
        !!auth?.paired,
      );
    });

    this.server.on("upgrade", (req, socket, head) => {
      const parsed = new URL(req.url || "/", this.getLocalBaseUrl());
      const clientKey = this.clientKey(req);
      if (parsed.pathname !== "/ws" || !this.isLocalRequest(req)) {
        socket.destroy();
        return;
      }
      if (!this.checkRate(`ws-auth:${clientKey}`, 20, 60_000)) {
        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        socket.destroy();
        return;
      }
      const auth = this.authenticate(
        parsed.searchParams.get("token") || undefined,
        req,
      );
      if (!auth.ok || !auth.deviceId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      (req as any).companionAuth = auth;
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit("connection", ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server!.once("error", onError);
      this.server!.listen(port, "0.0.0.0", () => {
        this.server!.off("error", onError);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo;
    this.port = address.port;
    this.startHeartbeat();
    this.emitStatus();
    return this.getStatus();
  }

  public async stop(): Promise<CompanionStatus> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    const sockets = [...this.sockets.keys()];
    sockets.forEach((socket) => socket.close(1001, "Companion stopped"));
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.server = null;
    this.port = null;
    this.pairing = null;
    this.emitStatus();
    return this.getStatus();
  }

  public async createPairingCode(): Promise<CompanionStatus> {
    if (!this.server) await this.start();
    const token = this.generateCredential();
    const url = `${this.getBestLanBaseUrl()}/pair?token=${encodeURIComponent(token)}`;
    this.pairing = {
      token,
      tokenHash: this.hashToken(token),
      url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }),
      expiresAt: Date.now() + PAIRING_TTL_MS,
    };
    this.emitStatus();
    return this.getStatus();
  }

  public getStatus(): CompanionStatus {
    this.dropExpiredPairing();
    const connectedIds = new Set(
      [...this.sockets.values()].map((state) => state.deviceId),
    );
    return {
      running: !!this.server,
      port: this.port,
      urls: this.getUrls(),
      activeConnections: this.sockets.size,
      pairedDevices: [...this.devices.values()]
        .filter((device) => !device.revokedAt)
        .map(({ tokenHash, ...device }) => ({
          ...device,
          connected: connectedIds.has(device.id),
        }))
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      pairing: this.pairing ? this.publicPairing(this.pairing) : null,
      settings: this.getSettings(),
    };
  }

  public updateSnapshot(
    partial: Partial<CompanionSnapshot>,
  ): CompanionSnapshot {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      transcriptSegments:
        partial.transcriptSegments ?? this.snapshot.transcriptSegments,
      messages: partial.messages ?? this.snapshot.messages,
      updatedAt: Date.now(),
    };
    this.broadcast("snapshot", this.snapshot);
    return this.snapshot;
  }

  public revokeDevice(deviceId: string): CompanionStatus {
    const device = this.devices.get(deviceId);
    if (device) {
      device.revokedAt = Date.now();
      this.devices.delete(deviceId);
      this.saveTrustedDevices();
    }
    for (const [socket, state] of this.sockets.entries()) {
      if (state.deviceId === deviceId) {
        socket.close(4001, "Device revoked");
        this.sockets.delete(socket);
      }
    }
    this.emitStatus();
    return this.getStatus();
  }

  public updateDeviceMetadata(
    deviceId: string,
    patch: Partial<Pick<CompanionDevice, "nickname" | "role" | "name">>,
  ): CompanionStatus {
    const device = this.devices.get(deviceId);
    if (!device) return this.getStatus();
    if (typeof patch.nickname === "string")
      device.nickname = this.cleanLabel(patch.nickname, 48) || undefined;
    if (typeof patch.name === "string")
      device.name = this.cleanLabel(patch.name, 64) || device.name;
    if (patch.role && ["controller", "viewer", "uploader"].includes(patch.role))
      device.role = patch.role;
    this.saveTrustedDevices();
    this.emitStatus();
    return this.getStatus();
  }

  public broadcast(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload, sentAt: Date.now() });
    for (const [socket] of this.sockets.entries()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  private async handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const parsed = new URL(req.url || "/", this.getLocalBaseUrl());
    const key = this.clientKey(req);

    if (!this.isLocalRequest(req)) {
      this.sendJson(res, 403, {
        error: "Phone companion only accepts local-network clients",
      });
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/health") {
      if (!this.checkRate(`health:${key}`, 120, 60_000))
        return this.sendJson(res, 429, { error: "Too many requests" });
      this.sendJson(res, 200, { ok: true, status: this.getStatus() });
      return;
    }

    if (
      req.method === "GET" &&
      (parsed.pathname === "/" ||
        parsed.pathname === "/pair" ||
        parsed.pathname === "/companion")
    ) {
      if (!this.checkRate(`pair-page:${key}`, 60, 60_000))
        return this.sendJson(res, 429, { error: "Too many pairing attempts" });
      const token = parsed.searchParams.get("token") || "";
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(this.renderCompanionHtml(token));
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/api/snapshot") {
      if (!this.checkRate(`snapshot:${key}`, 120, 60_000))
        return this.sendJson(res, 429, { error: "Too many requests" });
      const auth = this.authenticate(
        parsed.searchParams.get("token") || undefined,
        req,
      );
      if (!auth.ok) return this.sendJson(res, 401, { error: auth.error });
      this.sendJson(res, 200, {
        snapshot: this.snapshot,
        status: this.getStatus(),
        credential: auth.credential,
      });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/command") {
      if (!this.checkRate(`command:${key}`, 45, 60_000))
        return this.sendJson(res, 429, { error: "Too many commands" });
      const auth = this.authenticate(
        parsed.searchParams.get("token") || undefined,
        req,
      );
      if (!auth.ok || !auth.deviceId)
        return this.sendJson(res, 401, { error: auth.error });
      const body = await this.readJson(req);
      const command = this.buildCommand(body.type, body.payload, auth.deviceId);
      this.options.onCommand?.(command);
      this.broadcast("command-ack", command);
      this.sendJson(res, 200, {
        ok: true,
        command,
        credential: auth.credential,
      });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/api/upload") {
      if (!this.checkRate(`upload:${key}`, 12, 60_000))
        return this.sendJson(res, 429, { error: "Too many uploads" });
      const auth = this.authenticate(
        parsed.searchParams.get("token") || undefined,
        req,
      );
      if (!auth.ok || !auth.deviceId)
        return this.sendJson(res, 401, { error: auth.error });
      const body = await this.readJson(req);
      const uploaded = this.saveUpload(body);
      const command = this.buildCommand("attach-file", uploaded, auth.deviceId);
      this.options.onCommand?.(command);
      this.broadcast("command-ack", command);
      this.sendJson(res, 200, {
        ok: true,
        uploaded,
        command,
        credential: auth.credential,
      });
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  private handleSocket(
    socket: WebSocket,
    req: IncomingMessage,
    deviceId: string,
    credential?: string,
    paired = false,
  ): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = Date.now();
      device.remoteAddress = this.remoteAddress(req);
      device.userAgent = String(
        req.headers["user-agent"] || device.userAgent || "",
      ).slice(0, 240);
      this.saveTrustedDevices();
    }
    this.sockets.set(socket, {
      deviceId,
      alive: true,
      connectedAt: Date.now(),
    });
    this.emitStatus();

    this.sendSocket(socket, "hello", {
      deviceId,
      credential,
      paired,
      snapshot: this.snapshot,
      status: this.getStatus(),
    });

    socket.on("pong", () => {
      const state = this.sockets.get(socket);
      if (state) state.alive = true;
      this.touchDevice(state?.deviceId, req);
    });

    socket.on("message", (raw) => {
      try {
        const state = this.sockets.get(socket);
        const message = JSON.parse(String(raw));
        this.touchDevice(state?.deviceId, req);
        if (message?.type === "heartbeat") {
          this.sendSocket(socket, "heartbeat-ack", {
            at: Date.now(),
            status: this.getStatus(),
          });
          return;
        }
        if (message?.type === "device:update") {
          this.updateDeviceMetadata(deviceId, message.payload || {});
          this.sendSocket(socket, "device-updated", {
            device: this.getStatus().pairedDevices.find(
              (d) => d.id === deviceId,
            ),
          });
          return;
        }
        if (message?.type === "command") {
          const command = this.buildCommand(
            message.commandType || message.payload?.type || "ask",
            message.payload,
            deviceId,
          );
          this.options.onCommand?.(command);
          this.broadcast("command-ack", command);
        }
      } catch {
        this.sendSocket(socket, "error", { error: "Invalid message" });
      }
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
      this.emitStatus();
    });
  }

  private authenticate(
    token: string | undefined,
    req: IncomingMessage,
  ): AuthResult {
    this.dropExpiredPairing();
    if (!token) return { ok: false, error: "Missing token" };
    const tokenHash = this.hashToken(token);

    for (const device of this.devices.values()) {
      if (
        !device.revokedAt &&
        this.constantTimeEqual(device.tokenHash, tokenHash)
      ) {
        this.touchDevice(device.id, req);
        return { ok: true, deviceId: device.id };
      }
    }

    if (
      this.pairing &&
      this.constantTimeEqual(this.pairing.tokenHash, tokenHash) &&
      this.pairing.expiresAt >= Date.now()
    ) {
      const credential = this.generateCredential();
      const device = this.createTrustedDevice(req, credential);
      this.pairing = null;
      return { ok: true, deviceId: device.id, credential, paired: true };
    }

    return { ok: false, error: "Token expired, revoked, or invalid" };
  }

  private createTrustedDevice(
    req: IncomingMessage,
    credential: string,
  ): StoredCompanionDevice {
    const now = Date.now();
    const device: StoredCompanionDevice = {
      id: crypto.randomUUID(),
      name: this.guessDeviceName(req),
      role: "controller",
      pairedAt: now,
      createdAt: now,
      lastSeenAt: now,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
      remoteAddress: this.remoteAddress(req),
      tokenHash: this.hashToken(credential),
    };
    this.devices.set(device.id, device);
    this.saveTrustedDevices();
    this.emitStatus();
    return device;
  }

  private buildCommand(
    type: unknown,
    payload: any,
    deviceId: string,
  ): CompanionCommand {
    const normalizedType = ALLOWED_COMMANDS.has(
      String(type) as CompanionCommandType,
    )
      ? (String(type) as CompanionCommandType)
      : "ask";
    return {
      id: crypto.randomUUID(),
      type: normalizedType,
      payload: this.sanitizePayload(payload),
      receivedAt: Date.now(),
      deviceId,
    };
  }

  private sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== "object") return payload;
    const safe = { ...payload };
    if (typeof safe.text === "string") safe.text = safe.text.slice(0, 8_000);
    if (typeof safe.intent === "string") safe.intent = safe.intent.slice(0, 48);
    return safe;
  }

  private saveUpload(body: JsonObject): JsonObject {
    const name = this.safeFilename(body.name || `companion-${Date.now()}`);
    const mime = this.safeMime(body.mime || "application/octet-stream");
    const raw = String(body.dataBase64 || body.data || "");
    const data = raw.includes(",") ? raw.split(",").pop() || "" : raw;
    if (!/^[A-Za-z0-9+/=\-_\s]+$/.test(data))
      throw new Error("Upload payload is not valid base64");
    const buffer = Buffer.from(data, "base64");
    if (!buffer.length) throw new Error("Upload is empty");
    if (buffer.length > MAX_UPLOAD_BYTES)
      throw new Error("Upload is too large");

    const uploadDir = path.join(
      this.options.userDataDir,
      "phone-companion-uploads",
    );
    fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(
      uploadDir,
      `${Date.now()}-${crypto.randomUUID()}-${name}`,
    );
    const resolvedDir = path.resolve(uploadDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedDir + path.sep))
      throw new Error("Invalid upload path");
    fs.writeFileSync(resolvedFile, buffer, { flag: "wx" });

    const uploaded: JsonObject = {
      name,
      mime,
      size: buffer.length,
      path: resolvedFile,
      uploadedAt: Date.now(),
    };
    if (mime.startsWith("image/") && buffer.length <= 1_500_000) {
      uploaded.preview = `data:${mime};base64,${buffer.toString("base64")}`;
    }
    return uploaded;
  }

  private async readJson(req: IncomingMessage): Promise<JsonObject> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_JSON_BYTES) throw new Error("Request body is too large");
      chunks.push(buffer);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private sendJson(
    res: ServerResponse,
    status: number,
    body: JsonObject,
  ): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }

  private sendSocket(socket: WebSocket, type: string, payload: any): void {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type, payload, sentAt: Date.now() }));
  }

  private getUrls(): string[] {
    if (!this.port) return [];
    return [
      this.getLocalBaseUrl(),
      ...this.getLanAddresses().map(
        (address) => `http://${address}:${this.port}`,
      ),
    ];
  }

  private getLocalBaseUrl(): string {
    return `http://127.0.0.1:${this.port || 0}`;
  }

  private getBestLanBaseUrl(): string {
    const [first] = this.getLanAddresses();
    return `http://${first || "127.0.0.1"}:${this.port || 0}`;
  }

  private getLanAddresses(): string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal)
          addresses.push(entry.address);
      }
    }
    return addresses;
  }

  private generateCredential(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private dropExpiredPairing(): void {
    if (this.pairing && this.pairing.expiresAt < Date.now())
      this.pairing = null;
  }

  private publicPairing(
    pairing: CompanionPairing & { tokenHash: string },
  ): CompanionPairing {
    return {
      url: pairing.url,
      qrDataUrl: pairing.qrDataUrl,
      expiresAt: pairing.expiresAt,
      token: pairing.token,
    };
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      for (const [socket, state] of this.sockets.entries()) {
        if (socket.readyState !== WebSocket.OPEN || !state.alive) {
          socket.terminate();
          this.sockets.delete(socket);
          continue;
        }
        state.alive = false;
        socket.ping();
      }
      this.emitStatus();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private touchDevice(
    deviceId: string | undefined,
    req: IncomingMessage,
  ): void {
    if (!deviceId) return;
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.lastSeenAt = Date.now();
    device.remoteAddress = this.remoteAddress(req);
  }

  private loadTrustedDevices(): void {
    try {
      const filePath = this.devicesPath();
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
      for (const raw of devices) {
        if (!raw?.id || !raw?.tokenHash) continue;
        this.devices.set(String(raw.id), {
          id: String(raw.id),
          name: this.cleanLabel(raw.name, 64) || "Phone",
          nickname: this.cleanLabel(raw.nickname, 48) || undefined,
          role: ["controller", "viewer", "uploader"].includes(raw.role)
            ? raw.role
            : "controller",
          pairedAt: Number(raw.pairedAt || raw.createdAt || Date.now()),
          createdAt: Number(raw.createdAt || raw.pairedAt || Date.now()),
          lastSeenAt: Number(raw.lastSeenAt || raw.pairedAt || Date.now()),
          userAgent:
            typeof raw.userAgent === "string"
              ? raw.userAgent.slice(0, 240)
              : undefined,
          remoteAddress:
            typeof raw.remoteAddress === "string"
              ? raw.remoteAddress.slice(0, 80)
              : undefined,
          tokenHash: String(raw.tokenHash),
        });
      }
    } catch (error) {
      console.error(
        "[CompanionServer] Failed to load trusted device metadata:",
        error instanceof Error ? error.message : String(error),
      );
      this.devices.clear();
    }
  }

  private saveTrustedDevices(): void {
    try {
      fs.mkdirSync(this.options.userDataDir, { recursive: true });
      const filePath = this.devicesPath();
      const tmpPath = `${filePath}.tmp`;
      const devices = [...this.devices.values()]
        .filter((device) => !device.revokedAt)
        .map(({ connected, revokedAt, ...device }) => device);
      fs.writeFileSync(
        tmpPath,
        JSON.stringify({ version: 1, devices }, null, 2),
      );
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      console.error(
        "[CompanionServer] Failed to save trusted device metadata:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private devicesPath(): string {
    return path.join(this.options.userDataDir, TRUSTED_DEVICES_FILE);
  }

  private guessDeviceName(req: IncomingMessage): string {
    const ua = String(req.headers["user-agent"] || "Phone").slice(0, 160);
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android phone";
    if (/Mobile/i.test(ua)) return "Phone";
    return "Browser companion";
  }

  private remoteAddress(req: IncomingMessage): string | undefined {
    return req.socket.remoteAddress?.replace(/^::ffff:/, "").slice(0, 80);
  }

  private clientKey(req: IncomingMessage): string {
    return this.remoteAddress(req) || "unknown";
  }

  private isLocalRequest(req: IncomingMessage): boolean {
    const address = this.remoteAddress(req);
    if (!address) return true;
    if (address === "127.0.0.1" || address === "::1" || address === "localhost")
      return true;
    if (address.startsWith("10.") || address.startsWith("192.168."))
      return true;
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
    }
    if (/^f[cd][0-9a-f]{2}:/i.test(address) || /^fe80:/i.test(address))
      return true;
    return false;
  }

  private checkRate(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const current = this.rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      this.rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private normalizePort(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const port = Math.trunc(value);
    return port >= 1024 && port <= 65535 ? port : 0;
  }

  private cleanLabel(value: unknown, maxLength: number): string {
    return String(value || "")
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  private safeFilename(value: unknown): string {
    const original = path.basename(String(value || "")).normalize("NFKC");
    const cleaned = original
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "")
      .slice(0, 96)
      .trim();
    return cleaned || `companion-${Date.now()}.bin`;
  }

  private safeMime(value: unknown): string {
    const mime = String(value || "application/octet-stream")
      .toLowerCase()
      .slice(0, 120);
    return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)
      ? mime
      : "application/octet-stream";
  }

  private getSettings(): CompanionSettings {
    return { ...DEFAULT_SETTINGS, ...(this.options.getSettings?.() || {}) };
  }

  private emitStatus(): void {
    this.options.onStatusChanged?.(this.getStatus());
  }

  private renderCompanionHtml(initialToken: string): string {
    const escapedToken = this.escapeHtml(initialToken);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pika Companion</title>
<style>
:root{color-scheme:dark;--bg:#071018;--card:#101b27;--muted:#8ea0b5;--text:#ecf5ff;--accent:#8b5cf6;--ok:#22c55e;--bad:#fb7185;--line:#223246}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:radial-gradient(circle at top,#172036,#071018 55%);color:var(--text)}main{max-width:980px;margin:0 auto;padding:16px 14px 36px}.top{position:sticky;top:0;z-index:2;background:linear-gradient(180deg,rgba(7,16,24,.98),rgba(7,16,24,.86));backdrop-filter:blur(12px);padding:12px 0}.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.brand{font-size:20px;font-weight:800}.pill{border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:var(--muted);font-size:12px}.ok{color:var(--ok)}.bad{color:var(--bad)}.card{background:rgba(16,27,39,.86);border:1px solid var(--line);border-radius:18px;padding:14px;margin:12px 0;box-shadow:0 12px 40px rgba(0,0,0,.20)}button,.fileBtn{border:0;border-radius:14px;padding:12px 14px;background:#243247;color:var(--text);font-weight:700;min-height:44px}button.primary{background:linear-gradient(135deg,#7c3aed,#2563eb)}button.warn{background:#4a2430}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:12px;background:#0b1420;color:var(--text);padding:11px}textarea{min-height:82px}.muted{color:var(--muted);font-size:13px}.list{display:flex;flex-direction:column;gap:10px}.answer{border-left:3px solid var(--accent);padding-left:10px;white-space:pre-wrap}.transcript{max-height:260px;overflow:auto}.seg{padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}.seg b{color:#b7c6ff}.compact .optional{display:none}.compact .card{padding:10px;margin:8px 0}.compact button{padding:9px;min-height:38px;font-size:12px}.health{width:9px;height:9px;border-radius:999px;background:var(--bad);display:inline-block}.health.on{background:var(--ok)}.upload{border:1px dashed #38506b;border-radius:16px;padding:12px;text-align:center}.progress{height:8px;background:#152235;border-radius:999px;overflow:hidden}.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22c55e,#38bdf8)}@media(max-width:620px){.grid,.grid.three{grid-template-columns:1fr}main{padding:12px 10px 30px}}
</style>
</head>
<body>
<main id="app">
  <section class="top">
    <div class="row"><div><div class="brand">Pika Companion</div><div class="muted">Local browser controller</div></div><div class="pill"><span id="healthDot" class="health"></span> <span id="healthText">connecting</span></div></div>
  </section>
  <section class="card">
    <div class="row"><div><b id="deviceLabel">Unpaired phone</b><div class="muted" id="deviceMeta">Pair with QR, then reconnects automatically until revoked.</div></div><button id="compactBtn">Compact</button></div>
    <div class="grid optional" style="margin-top:12px"><input id="nickname" placeholder="Nickname" maxlength="48"/><select id="role"><option value="controller">Controller</option><option value="viewer">Viewer</option><option value="uploader">Uploader</option></select></div>
    <div class="muted" id="statusLine" style="margin-top:10px"></div>
  </section>
  <section class="card">
    <textarea id="askText" placeholder="Ask or add a note for Pika..."></textarea>
    <div class="grid three" style="margin-top:10px"><button class="primary" data-cmd="ask">Ask</button><button data-cmd="what_to_answer">What to answer</button><button data-cmd="clarify">Clarify</button><button data-cmd="recap">Recap</button><button data-cmd="brainstorm">Brainstorm</button><button data-cmd="follow_up">Follow-up</button><button data-cmd="code_hint">Code hint</button><button data-cmd="reset_cancel">Reset/Cancel</button><button data-cmd="toggle_visibility">Hide/Show</button><button data-cmd="mouse_passthrough">Mouse pass</button><button data-cmd="screenshot">Screenshot</button><button data-cmd="selective_screenshot">Select area</button></div>
  </section>
  <section class="card optional">
    <b>Upload context</b><div class="muted">Camera photos or any local file are sent only over your LAN to the desktop.</div>
    <div class="grid" style="margin-top:10px"><label class="fileBtn">Camera/photo<input id="photoInput" type="file" accept="image/*" capture="environment" hidden></label><label class="fileBtn">Choose file<input id="fileInput" type="file" hidden></label></div>
    <div class="upload muted" id="uploadStatus" style="margin-top:10px">No upload in progress</div><div class="progress"><i id="progressBar"></i></div>
  </section>
  <section class="card">
    <div class="row"><b>Live answers</b><button id="cueBtn">Cue mode</button></div><div id="answers" class="list"></div>
  </section>
  <section class="card optional"><b>Transcript</b><div id="transcript" class="transcript"></div></section>
  <section class="card optional"><b>Trusted devices</b><div id="devices" class="list muted"></div></section>
</main>
<script>
(function(){
var pairingToken='${escapedToken}';
var credential=localStorage.getItem('pikaCompanionCredential') || '';
var token=credential || pairingToken;
var ws=null,reconnectTimer=null,heartbeatTimer=null,lastSeen=0,status=null,snapshot=null,compact=false,cue=false;
function el(id){return document.getElementById(id)}
function setHealth(text,on){el('healthText').textContent=text;el('healthDot').className='health '+(on?'on':'');}
function api(path,body){return fetch(path+'?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(res){return res.json().then(function(json){if(!res.ok)throw new Error(json.error||'Request failed'); if(json.credential) saveCredential(json.credential); return json;});});}
function saveCredential(value){if(value){credential=value;token=value;localStorage.setItem('pikaCompanionCredential',value);history.replaceState(null,'','/companion');}}
function connect(){clearTimeout(reconnectTimer); if(ws&&ws.readyState<2)return; setHealth('connecting',false); var proto=location.protocol==='https:'?'wss:':'ws:'; ws=new WebSocket(proto+'//'+location.host+'/ws?token='+encodeURIComponent(token)); ws.onopen=function(){setHealth('connected',true); lastSeen=Date.now(); clearInterval(heartbeatTimer); heartbeatTimer=setInterval(function(){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'heartbeat'})); if(Date.now()-lastSeen>45000)setHealth('stale',false);},15000);}; ws.onmessage=function(ev){lastSeen=Date.now(); var msg=JSON.parse(ev.data); if(msg.type==='hello'){if(msg.payload.credential)saveCredential(msg.payload.credential); snapshot=msg.payload.snapshot; status=msg.payload.status; render();} if(msg.type==='snapshot'){snapshot=msg.payload; render();} if(msg.type==='heartbeat-ack'){status=msg.payload.status; render();} if(msg.type==='command-ack'){flash('Sent '+msg.payload.type);} if(msg.type==='device-updated'){flash('Device updated');}}; ws.onclose=function(){setHealth('reconnecting',false); reconnectTimer=setTimeout(connect,1500);}; ws.onerror=function(){setHealth('connection error',false);};}
function flash(text){el('statusLine').textContent=text+' · '+new Date().toLocaleTimeString();}
function sendCommand(type){var text=el('askText').value.trim(); api('/api/command',{type:type,payload:{text:text}}).then(function(){if(type==='ask')el('askText').value='';flash('Command sent');}).catch(function(e){flash(e.message);});}
function upload(file){if(!file)return; if(file.size>10*1024*1024){flash('File is too large (10MB max)');return;} var reader=new FileReader(); reader.onprogress=function(e){if(e.lengthComputable)el('progressBar').style.width=Math.round(e.loaded/e.total*100)+'%';}; reader.onload=function(){el('uploadStatus').textContent='Uploading '+file.name; api('/api/upload',{name:file.name,mime:file.type||'application/octet-stream',data:String(reader.result)}).then(function(){el('uploadStatus').textContent='Uploaded '+file.name;el('progressBar').style.width='100%';}).catch(function(e){el('uploadStatus').textContent=e.message;});}; reader.readAsDataURL(file);}
function render(){document.body.className=compact?'compact':''; var devices=(status&&status.pairedDevices)||[]; var mine=devices.find(function(d){return d.connected;})||devices[0]; el('deviceLabel').textContent=mine?(mine.nickname||mine.name)+' · '+mine.role:'Phone companion'; el('deviceMeta').textContent=mine?('Last seen '+new Date(mine.lastSeenAt).toLocaleTimeString()+(mine.connected?' · connected':'')):'Waiting for pairing'; if(mine){el('nickname').value=mine.nickname||''; el('role').value=mine.role||'controller';} el('devices').innerHTML=devices.map(function(d){return '<div>'+esc(d.nickname||d.name)+' · '+esc(d.role)+' · '+(d.connected?'connected':'trusted')+'</div>';}).join('')||'No trusted devices yet'; var msgs=(snapshot&&snapshot.messages)||[]; if(cue)msgs=msgs.slice(-1); el('answers').innerHTML=msgs.slice(-8).reverse().map(function(m){return '<div class="answer"><b>'+esc(m.intent||m.role||'answer')+'</b><br>'+esc(m.text||'')+'</div>';}).join('')||'<div class="muted">No answers yet.</div>'; var segs=(snapshot&&snapshot.transcriptSegments)||[]; el('transcript').innerHTML=segs.slice(-40).map(function(s){return '<div class="seg"><b>'+esc(s.speakerLabel||s.speaker||'Speaker')+'</b> '+esc(s.text||'')+'</div>';}).join('')||'<div class="muted">No transcript yet.</div>'; el('compactBtn').textContent=compact?'Full':'Compact'; el('cueBtn').textContent=cue?'All cards':'Cue mode';}
function updateDevice(){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'device:update',payload:{nickname:el('nickname').value,role:el('role').value}}));}
function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
document.querySelectorAll('[data-cmd]').forEach(function(b){b.addEventListener('click',function(){sendCommand(b.getAttribute('data-cmd'));});});
el('photoInput').addEventListener('change',function(e){upload(e.target.files[0]);}); el('fileInput').addEventListener('change',function(e){upload(e.target.files[0]);}); el('compactBtn').onclick=function(){compact=!compact;render();}; el('cueBtn').onclick=function(){cue=!cue;render();}; el('nickname').addEventListener('change',updateDevice); el('role').addEventListener('change',updateDevice);
connect();
})();
</script>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char] || char,
    );
  }
}
