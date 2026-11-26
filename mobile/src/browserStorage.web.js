let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('qwork-media-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(new Error('Хранилище браузера недоступно. Проверьте свободное место.')); };
  });
  return opening;
}

export async function storedMedia(operation, key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', operation === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('files');
    const request = operation === 'put' ? store.put(value, key) : store[operation](key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(new Error('Не удалось сохранить файл в браузере. Проверьте свободное место.'));
  });
}

export function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(blob);
  });
}
