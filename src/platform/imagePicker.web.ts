import type * as ImagePicker from 'expo-image-picker';

import { blobToBase64 } from './base64';
import type { Conforms } from './conformance';
import type { ImagePermissionOutcome } from './imagePicker';

export type { ImagePermissionOutcome };

// expo-image-picker documents its permission requests as no-ops on web: the
// browser prompts during the picker/getUserMedia call itself. Reporting
// "granted" here keeps the calling flow identical on both platforms.
const granted: ImagePermissionOutcome = { granted: true, message: '' };

// Desktop browsers rarely have a usable camera and getUserMedia is blocked on
// insecure origins, so the camera action is only offered where it can work.
export const supportsCameraCapture =
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  (typeof window === 'undefined' || window.isSecureContext);

export const cameraActionLabel = 'Use camera';

export async function requestPhotoLibraryAccess(): Promise<ImagePermissionOutcome> {
  return granted;
}

export async function requestCameraAccess(): Promise<ImagePermissionOutcome> {
  if (!supportsCameraCapture) {
    return {
      granted: false,
      message:
        'This browser has no available camera. Use “Choose photo” to upload an image instead.',
    };
  }

  return granted;
}

/**
 * On web the picker returns a `File`, and `base64` is not guaranteed to be
 * populated. Read the file directly when it is missing.
 */
export async function readAssetBase64(asset: ImagePicker.ImagePickerAsset) {
  if (asset.base64) return asset.base64;

  const file = (asset as { file?: File }).file;

  if (file) {
    return blobToBase64(file);
  }

  if (asset.uri) {
    const response = await fetch(asset.uri);

    if (response.ok) {
      return blobToBase64(await response.blob());
    }
  }

  return null;
}

type _Conformance = Conforms<
  typeof import('./imagePicker'),
  typeof import('./imagePicker.web')
>;
