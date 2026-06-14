import fs from 'fs';
import os from 'os';
import path from 'path';
import t from 'tap';
import { ConfigBackupManager } from '../electron/services/ConfigBackupManager';

function makeFixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-config-backup-test-'));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, 'config');
  const userDataDir = path.join(root, 'userData');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const settingsPath = path.join(configDir, 'settings.json');
  const credentialsPath = path.join(configDir, 'credentials.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ isUndetectable: true, companion: { autoStart: true, preferredPort: 4123 } }, null, 2));
  fs.writeFileSync(credentialsPath, JSON.stringify({ geminiApiKey: 'gemini-test-value', openaiCompatibleProviders: [{ id: 'local', name: 'Local', baseUrl: 'https://example.invalid/v1', apiKey: 'provider-test-value' }] }, null, 2));
  fs.writeFileSync(path.join(userDataDir, 'phone-companion-devices.json'), JSON.stringify({ version: 1, devices: [{ id: 'phone-1', name: 'Phone', tokenHash: 'hash-value' }] }, null, 2));
  fs.writeFileSync(path.join(userDataDir, 'keybinds.json'), JSON.stringify([{ id: 'chat:whatToAnswer', accelerator: 'CommandOrControl+Enter' }], null, 2));
  const manager = new ConfigBackupManager({ userDataDir, appVersion: 'test-version', settingsPath, credentialsPath, backupRoot: path.join(root, 'backups') });
  return { root, configDir, userDataDir, settingsPath, credentialsPath, manager };
}

t.test('exports all config domains with metadata and secrets flag', (t) => {
  const { manager } = makeFixture(t);
  const exported = manager.buildExport({ localStorage: { preferredInputDeviceId: 'mic-1' } });

  t.equal(exported.metadata.schemaVersion, 1);
  t.equal(exported.metadata.appVersion, 'test-version');
  t.equal(exported.metadata.includesSecrets, true);
  t.same(exported.metadata.domains.sort(), ['clientPreferences', 'companionTrustedDevices', 'credentials', 'keybinds', 'settings'].sort());
  t.equal((exported.data.credentials as any).geminiApiKey, 'gemini-test-value');
  t.equal(((exported.data.credentials as any).openaiCompatibleProviders[0] as any).apiKey, 'provider-test-value');
  t.equal((exported.data.clientPreferences as any).localStorage.preferredInputDeviceId, 'mic-1');
  t.end();
});

t.test('redacted preview hides secret-like values without changing export payload', (t) => {
  const { manager } = makeFixture(t);
  const preview = manager.buildPreview();
  const exported = manager.buildExport();

  t.equal((preview.data.credentials as any).geminiApiKey, '••••••••');
  t.equal(((preview.data.credentials as any).openaiCompatibleProviders[0] as any).apiKey, '••••••••');
  t.equal(((preview.data.companionTrustedDevices as any).devices[0] as any).tokenHash, '••••••••');
  t.equal((exported.data.credentials as any).geminiApiKey, 'gemini-test-value');
  t.end();
});

t.test('invalid import shape is rejected', (t) => {
  const { manager } = makeFixture(t);
  t.throws(() => manager.validateImport({ metadata: { schemaVersion: 999 }, data: {} }), /Unsupported config backup schema version/);
  t.throws(() => manager.validateImport({ metadata: { schemaVersion: 1 }, data: { unexpected: {} } }), /unsupported domain/);
  t.throws(() => manager.validateImport({ metadata: { schemaVersion: 1 }, data: { keybinds: {} } }), /malformed keybinds/);
  t.end();
});

t.test('import creates backup and writes expected files', (t) => {
  const { manager, settingsPath, credentialsPath, userDataDir } = makeFixture(t);
  const payload = manager.buildExport();
  (payload.data.settings as any).verboseLogging = true;
  (payload.data.credentials as any).claudeApiKey = 'claude-test-value';
  payload.data.keybinds = [{ id: 'general:toggle-visibility', accelerator: 'CommandOrControl+Shift+P' }];

  const result = manager.importPayload(payload);

  t.equal(result.success, true);
  t.ok(fs.existsSync(result.backup.backupDir));
  t.ok(result.backup.files.settings);
  t.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).verboseLogging, true);
  t.equal(JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).claudeApiKey, 'claude-test-value');
  t.equal(JSON.parse(fs.readFileSync(path.join(userDataDir, 'keybinds.json'), 'utf8'))[0].id, 'general:toggle-visibility');
  t.end();
});
