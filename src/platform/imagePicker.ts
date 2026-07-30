import * as ImagePicker from 'expo-image-picker';

export type ImagePermissionOutcome = {
  granted: boolean;
  /** Message to show when `granted` is false. */
  message: string;
};

export const supportsCameraCapture: boolean = true;

export const cameraActionLabel: string = 'Take photo';

export async function requestPhotoLibraryAccess(): Promise<ImagePermissionOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  return {
    granted: permission.granted,
    message: permission.canAskAgain
      ? 'Photo library permission is required.'
      : 'Photo access is disabled. Enable it in iPhone Settings to choose an image.',
  };
}

export async function requestCameraAccess(): Promise<ImagePermissionOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();

  return {
    granted: permission.granted,
    message: permission.canAskAgain
      ? 'Camera permission is required.'
      : 'Camera access is disabled. Enable it in iPhone Settings to take a photo.',
  };
}

/** iOS always populates `base64` when the picker is asked for it. */
export async function readAssetBase64(asset: ImagePicker.ImagePickerAsset) {
  return asset.base64 ?? null;
}
