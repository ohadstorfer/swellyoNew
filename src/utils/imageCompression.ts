import { Platform } from 'react-native';

// Conditionally import expo-image-manipulator only for native — on web the
// package is not available and we fall back to a canvas pipeline.
let ImageManipulator: any = null;
if (Platform.OS !== 'web') {
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (error) {
    console.warn('[imageCompression] expo-image-manipulator not available:', error);
  }
}

export interface CompressOptions {
  maxDimension: number; // cap for the longer edge, aspect ratio preserved
  quality: number; // 0..1 — JPEG quality
}

const getImageDimensionsNative = (uri: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const Image = require('react-native').Image;
    Image.getSize(uri, (width: number, height: number) => resolve({ width, height }), reject);
  });

async function compressNative(uri: string, opts: CompressOptions): Promise<string> {
  if (!ImageManipulator) {
    throw new Error('expo-image-manipulator is not available');
  }

  const { width, height } = await getImageDimensionsNative(uri);

  const longestEdge = Math.max(width, height);
  const actions: any[] = [];
  if (longestEdge > opts.maxDimension) {
    const ratio = opts.maxDimension / longestEdge;
    actions.push({
      resize: {
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      },
    });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: opts.quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return result.uri;
}

function compressWeb(uri: string, opts: CompressOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const ImageConstructor =
      (typeof window !== 'undefined' && window.Image) || (global as any).Image;
    const img = new ImageConstructor();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width: number = img.width;
      let height: number = img.height;

      const longestEdge = Math.max(width, height);
      if (longestEdge > opts.maxDimension) {
        const ratio = opts.maxDimension / longestEdge;
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        opts.quality,
      );
    };

    img.onerror = reject;
    img.src = uri;
  });
}

/**
 * Resize + compress an image to a JPEG. Aspect ratio is preserved; only the
 * longest edge is capped at `maxDimension`. Returns a new URI ready to upload
 * (`file://...` on native, `data:...` on web).
 */
export async function compressImage(uri: string, opts: CompressOptions): Promise<string> {
  if (Platform.OS === 'web') {
    return compressWeb(uri, opts);
  }
  return compressNative(uri, opts);
}
