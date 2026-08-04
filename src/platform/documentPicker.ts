import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

export type PickedPdf = {
  base64: string;
  fileName: string;
};

export const pdfPickerLabel: string = 'Choose PDF';

/**
 * iOS returns a local file URI, so the bytes are read off disk the same way
 * src/platform/recording.ts reads a finished recording.
 */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  const base64 = await readAsStringAsync(asset.uri, {
    encoding: EncodingType.Base64,
  });

  return { base64, fileName: asset.name || 'document.pdf' };
}
