import { blobBase64 } from './browserStorage';

export function photoFile(uri) {
  let pending;
  const load = () => pending ??= fetch(uri).then(response => {
    if (!response.ok) throw new Error('Не удалось открыть фотографию.');
    return response.blob();
  });
  return {
    size: 0,
    exists: false,
    async base64() {
      const blob = await load();
      if (blob.size > 12 * 1024 * 1024) throw new Error('Размер снимка превышает 12 МБ.');
      return blobBase64(blob);
    },
    open() {
      return {
        async readBytes(length) {
          const blob = await load();
          if (blob.size > 12 * 1024 * 1024) throw new Error('Размер снимка превышает 12 МБ.');
          return new Uint8Array(await blob.slice(0, length).arrayBuffer());
        },
        close() {},
      };
    },
  };
}
