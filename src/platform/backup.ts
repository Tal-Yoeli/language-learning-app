import { Share } from 'react-native';

export type BackupExport = {
  /** Message shown in the notice bar after a successful export. */
  message: string;
};

/** The web build can open a file picker; iOS keeps the paste-JSON flow. */
export const supportsBackupFilePicker: boolean = false;

export const backupExportLabel: string = 'Share backup';

export const backupExportHint: string =
  'Opens the iOS share sheet so the backup JSON can be sent to Notes, Files, or another device.';

export async function exportBackup(
  _fileName: string,
  json: string,
): Promise<BackupExport> {
  await Share.share({
    title: 'Language Learning App backup',
    message: json,
  });

  return { message: 'Backup opened in the iOS share sheet.' };
}

export async function pickBackupFile(): Promise<string | null> {
  return null;
}
