import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { ConfigBackupManager } from '../services/ConfigBackupManager';
import { CredentialsManager } from '../services/CredentialsManager';
import { SettingsManager } from '../services/SettingsManager';
import { safeHandle } from './safeHandle';

function manager(): ConfigBackupManager {
  return new ConfigBackupManager({
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerConfigBackupHandlers(): void {
  safeHandle('config-backup:preview-export', async (_, clientPreferences?: Record<string, unknown>) => manager().buildPreview(clientPreferences));

  safeHandle('config-backup:create-backup', async () => {
    try {
      return { success: true, backup: manager().createBackup('manual') };
    } catch (error) {
      return { success: false, error: safeError(error) };
    }
  });

  safeHandle('config-backup:export-all', async (_, clientPreferences?: Record<string, unknown>) => {
    try {
      const defaultPath = path.join(app.getPath('documents'), `pika-full-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      const result = await dialog.showSaveDialog({
        title: 'Export Pika full config including API keys',
        defaultPath,
        buttonLabel: 'Export Config + Keys',
        filters: [{ name: 'Pika Config Backup', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { success: false, cancelled: true };
      const payload = manager().exportToFile(result.filePath, clientPreferences);
      return {
        success: true,
        filePath: result.filePath,
        metadata: payload.metadata,
      };
    } catch (error) {
      return { success: false, error: safeError(error) };
    }
  });

  safeHandle('config-backup:import-all', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Pika config backup',
        buttonLabel: 'Import Config Backup',
        filters: [{ name: 'Pika Config Backup', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true };
      const backupPayload = manager().validateImport(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')));
      const importResult = manager().importPayload(backupPayload);
      SettingsManager.getInstance().reload();
      CredentialsManager.getInstance().reload();
      return { ...importResult, clientPreferences: backupPayload.data.clientPreferences };
    } catch (error) {
      return { success: false, error: safeError(error) };
    }
  });
}
