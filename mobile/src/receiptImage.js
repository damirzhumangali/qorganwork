import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

function releaseUrl(uri) {
  if (Platform.OS === 'web' && uri?.startsWith('blob:')) URL.revokeObjectURL(uri);
}

export async function prepareReceipt(asset) {
  if (!asset?.uri) throw new Error('Не удалось открыть фото. Выберите его ещё раз.');
  let context; let image;
  try {
    context = ImageManipulator.manipulate(asset.uri, { maxWidth: 2400, maxHeight: 2400 });
    image = await context.renderAsync();
    // Preserve the full frame and try a high-quality copy first for legible receipt text.
    for (const compress of [0.85, 0.7, 0.55]) {
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
      releaseUrl(result.uri);
      if (result.base64 && result.base64.length < 1999900) return `data:image/jpeg;base64,${result.base64}`;
    }
    throw new Error('Фото слишком большое даже после уменьшения. Выберите более компактный снимок с читаемым текстом.');
  } catch (error) {
    if (error.message?.startsWith('Фото слишком большое')) throw error;
    throw new Error('Не удалось подготовить фото чека. Попробуйте снимок в JPG или PNG.');
  } finally {
    image?.release(); context?.release(); releaseUrl(asset.uri);
  }
}
