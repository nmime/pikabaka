import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCredentialsJsonPath, getSettingsJsonPath } from './configPaths';

export const CONFIG_EXPORT_SCHEMA_VERSION = 1;

export type ConfigDomain = 'settings' | 'credentials' | 'companionTrustedDevices' | 'keybinds' | 'clientPreferences';

export interface ConfigExportMetadata {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  platform: NodeJS.Platform;
  includesSecrets: boolean;
  domains: ConfigDomain[];
}

export interface PikaConfigExport {
  metadata: ConfigExportMetadata;
  data: Partial<Record<ConfigDomain, unknown>>;
}

export interface ConfigBackupResult {
  backupDir: string;
  files: Partial<Record<ConfigDomain, string>>;
}

export interface ConfigImportResult {
  success: true;
  backup: ConfigBackupResult;
  importedDomains: ConfigDomain[];
}

export interface ConfigExportPreview {
  metadata: ConfigExportMetadata;
  data: Partial<Record<ConfigDomain, unknown>>;
  warnings: string[];
}

interface ConfigBackupManagerOptions {
  userDataDir: string;
  appVersion: string;
  settingsPath?: string;
  credentialsPath?: string;
  backupRoot?: string;
}

interface DomainFile {
  domain: ConfigDomain;
  path: string;
}

const COMPANION_DEVICES_FILE = 'phone-companion-devices.json';
const KEYBINDS_FILE = 'keybinds.json';

export class ConfigBackupManager {
  private readonly userDataDir: string;
  private readonly appVersion: string;
  private readonly settingsPath: string;
  private readonly credentialsPath: string;
  private readonly backupRoot: string;

  constructor(options: ConfigBackupManagerOptions) {
    this.userDataDir = options.userDataDir;
    this.appVersion = options.appVersion;
    this.settingsPath = options.settingsPath || getSettingsJsonPath();
    this.credentialsPath = options.credentialsPath || getCredentialsJsonPath();
    this.backupRoot = options.backupRoot || path.join(this.userDataDir, 'config-backups');
  }

  public buildExport(clientPreferences?: Record<string, unknown>): PikaConfigExport {
    const data: Partial<Record<ConfigDomain, unknown>> = {};
    const domains: ConfigDomain[] = [];

    for (const entry of this.domainFiles()) {
      if (!fs.existsSync(entry.path)) continue;
      const parsed = this.readJsonFile(entry.path, entry.domain);
      data[entry.domain] = parsed;
      domains.push(entry.domain);
    }

    if (clientPreferences && Object.keys(clientPreferences).length > 0) {
      data.clientPreferences = clientPreferences;
      domains.push('clientPreferences');
    }

    return {
      metadata: this.buildMetadata(domains, domains.includes('credentials')),
      data,
    };
  }

  public buildPreview(clientPreferences?: Record<string, unknown>): ConfigExportPreview {
    const full = this.buildExport(clientPreferences);
    return {
      metadata: full.metadata,
      data: this.redactSecrets(full.data),
      warnings: [
        'Full export includes API keys, provider credentials, custom provider commands, and companion device trust data when present.',
        'Preview redacts sensitive values. The exported backup file intentionally keeps them so it can restore your full setup.',
      ],
    };
  }

  public exportToFile(filePath: string, clientPreferences?: Record<string, unknown>): PikaConfigExport {
    const normalized = this.normalizeOutputPath(filePath);
    const payload = this.buildExport(clientPreferences);
    fs.mkdirSync(path.dirname(normalized), { recursive: true });
    this.atomicWriteJson(normalized, payload);
    return payload;
  }

  public importFromFile(filePath: string): ConfigImportResult {
    const parsed = this.readJsonFile(filePath, 'settings') as unknown;
    const payload = this.validateImport(parsed);
    return this.importPayload(payload);
  }

  public importPayload(payload: PikaConfigExport): ConfigImportResult {
    const validated = this.validateImport(payload);
    const importedDomains = Object.keys(validated.data) as ConfigDomain[];
    if (importedDomains.length === 0) {
      throw new Error('Backup does not contain any supported config domains.');
    }

    const backup = this.createBackup('before-import');
    const written: Array<{ file: DomainFile; backupFile?: string }> = [];

    try {
      for (const domain of importedDomains) {
        if (domain === 'clientPreferences') continue;
        const file = this.domainFiles().find((entry) => entry.domain === domain);
        if (!file) continue;
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        this.atomicWriteJson(file.path, validated.data[domain]);
        written.push({ file, backupFile: backup.files[domain] });
      }
    } catch (error) {
      this.restoreWrittenFiles(written);
      throw error;
    }

    return { success: true, backup, importedDomains };
  }

  public createBackup(label = 'manual'): ConfigBackupResult {
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'backup';
    const backupDir = path.join(this.backupRoot, `${safeLabel}-${this.timestampForPath()}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const files: Partial<Record<ConfigDomain, string>> = {};
    for (const entry of this.domainFiles()) {
      if (!fs.existsSync(entry.path)) continue;
      const destination = path.join(backupDir, path.basename(entry.path));
      fs.copyFileSync(entry.path, destination);
      files[entry.domain] = destination;
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      appVersion: this.appVersion,
      domains: Object.keys(files),
      files: Object.fromEntries(Object.entries(files).map(([domain, file]) => [domain, path.basename(file as string)])),
    };
    this.atomicWriteJson(path.join(backupDir, 'manifest.json'), manifest);
    return { backupDir, files };
  }

  public validateImport(input: unknown): PikaConfigExport {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid config backup: expected an object.');
    }
    const candidate = input as PikaConfigExport;
    if (!candidate.metadata || typeof candidate.metadata !== 'object') {
      throw new Error('Invalid config backup: missing metadata.');
    }
    if (candidate.metadata.schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) {
      throw new Error(`Unsupported config backup schema version: ${String(candidate.metadata.schemaVersion)}`);
    }
    if (!candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data)) {
      throw new Error('Invalid config backup: missing data object.');
    }

    const allowed = new Set<ConfigDomain>(['settings', 'credentials', 'companionTrustedDevices', 'keybinds', 'clientPreferences']);
    for (const domain of Object.keys(candidate.data)) {
      if (!allowed.has(domain as ConfigDomain)) {
        throw new Error(`Invalid config backup: unsupported domain ${domain}.`);
      }
      const value = candidate.data[domain as ConfigDomain];
      if (!this.isValidDomainValue(domain as ConfigDomain, value)) {
        throw new Error(`Invalid config backup: malformed ${domain} domain.`);
      }
    }

    return candidate;
  }

  public redactSecrets<T>(value: T): T {
    return this.redactValue(value, '') as T;
  }

  private domainFiles(): DomainFile[] {
    return [
      { domain: 'settings', path: this.settingsPath },
      { domain: 'credentials', path: this.credentialsPath },
      { domain: 'companionTrustedDevices', path: path.join(this.userDataDir, COMPANION_DEVICES_FILE) },
      { domain: 'keybinds', path: path.join(this.userDataDir, KEYBINDS_FILE) },
    ];
  }

  private buildMetadata(domains: ConfigDomain[], includesSecrets: boolean): ConfigExportMetadata {
    return {
      schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
      appVersion: this.appVersion,
      exportedAt: new Date().toISOString(),
      platform: process.platform,
      includesSecrets,
      domains,
    };
  }

  private readJsonFile(filePath: string, domain: ConfigDomain): unknown {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to read ${domain} config JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private atomicWriteJson(filePath: string, value: unknown): void {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  private restoreWrittenFiles(written: Array<{ file: DomainFile; backupFile?: string }>): void {
    for (const item of written.reverse()) {
      try {
        if (item.backupFile && fs.existsSync(item.backupFile)) {
          fs.copyFileSync(item.backupFile, item.file.path);
        } else if (fs.existsSync(item.file.path)) {
          fs.unlinkSync(item.file.path);
        }
      } catch {
        // Best-effort rollback. The original backup path is returned/thrown to the caller by import.
      }
    }
  }

  private isValidDomainValue(domain: ConfigDomain, value: unknown): boolean {
    if (domain === 'keybinds') return Array.isArray(value);
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private redactValue(value: unknown, keyName: string): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item, keyName));
    if (!value || typeof value !== 'object') {
      return this.isSensitiveKey(keyName) && value !== undefined && value !== null && value !== '' ? '••••••••' : value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = this.redactValue(nested, key);
    }
    return output;
  }

  private isSensitiveKey(keyName: string): boolean {
    return /(api[-_]?key|apikey|secret|token|password|credential|authorization|curlcommand|serviceaccount)/i.test(keyName);
  }

  private normalizeOutputPath(filePath: string): string {
    const expanded = filePath.startsWith('~/') ? path.join(os.homedir(), filePath.slice(2)) : filePath;
    if (!expanded.toLowerCase().endsWith('.json')) return `${expanded}.json`;
    return expanded;
  }

  private timestampForPath(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
