import * as DocumentPicker from 'expo-document-picker';

import { blobToBase64 } from './base64';
import type { Conforms } from './conformance';
import type { PickedPdf } from './documentPicker';

export type { PickedPdf };

export const pdfPickerLabel: string = 'Upload PDF';

/**
 * On the web the picker hands back a `File` (and sometimes a base64 string)
 * rather than a readable file path, so there is nothing to read off disk.
 */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset) return null;

  const fileName = asset.name || 'document.pdf';

  if (asset.file) {
    return { base64: await blobToBase64(asset.file), fileName };
  }

  // Some browsers populate `uri` with a blob: or data: URL instead.
  if (asset.uri) {
    const response = await fetch(asset.uri);

    if (response.ok) {
      return { base64: await blobToBase64(await response.blob()), fileName };
    }
  }

  throw new Error('That PDF could not be read by the browser.');
}

type _Conformance = Conforms<
  typeof import('./documentPicker'),
  typeof import('./documentPicker.web')
>;
