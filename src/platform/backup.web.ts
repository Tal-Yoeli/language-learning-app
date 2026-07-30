import type { BackupExport } from './backup';
import type { Conforms } from './conformance';

export type { BackupExport };

export const supportsBackupFilePicker = true;

export const backupExportLabel = 'Download backup';

export const backupExportHint =
  'Saves a .json file you can keep, or load into another browser or computer.';

/**
 * navigator.share is missing on desktop Firefox and inconsistent on desktop
 * Chrome, so the web build downloads a real file instead. That is also the more
 * useful outcome: the JSON can be re-imported by file rather than pasted.
 */
export async function exportBackup(
  fileName: string,
  json: string,
): Promise<BackupExport> {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { message: `Backup downloaded as ${fileName}.` };
}

export async function pickBackupFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');

    input.type = 'file';
    input.accept = 'application/json,.json,text/plain,.txt';
    input.style.display = 'none';

    // Browsers do not fire a reliable cancel event everywhere; `cancel` is
    // supported in current engines and the element is cleaned up either way.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();

      if (!file) {
        resolve(null);
        return;
      }

      file
        .text()
        .then(resolve)
        .catch(() =>
          reject(new Error('That file could not be read by the browser.')),
        );
    });

    document.body.appendChild(input);
    input.click();
  });
}

type _Conformance = Conforms<
  typeof import('./backup'),
  typeof import('./backup.web')
>;
