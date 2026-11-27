const storageError = (message, cause) => Object.assign(new Error(message), { code: 'demo_storage', cause });
const conflict = () => storageError('Демо изменилось в другой вкладке. Обновите карточку и повторите сохранение.');

// A separate IndexedDB snapshot keeps receipt images out of the small localStorage quota.
// The legacy snapshot is only read, never removed or overwritten during migration.
export function createDemoBrowserStorage(legacy, factory) {
  let opening;
  const reads = new Map();
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!factory) { reject(storageError('Хранилище демо недоступно. Разрешите сайту сохранять данные в браузере.')); return; }
      let request; let abandoned = false;
      try { request = factory.open('qwork-demo-v1', 1); }
      catch (error) { reject(storageError('Не удалось открыть хранилище демо. Разрешите сайту сохранять данные в браузере.', error)); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onerror = () => reject(storageError('Не удалось открыть хранилище демо. Данные не удалены. Попробуйте обновить страницу.', request.error));
      request.onblocked = () => { abandoned = true; reject(storageError('Обновите другие вкладки qwork, чтобы открыть хранилище демо.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  return {
    async getItem(key) {
      const db = await database();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const request = tx.objectStore('snapshots').get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(storageError('Не удалось прочитать сохранённое демо. Обновите страницу и попробуйте снова.', tx.error));
      });
      if (record && (!Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.value !== 'string')) {
        throw storageError('Не удалось прочитать сохранённое демо. Данные не изменены.');
      }
      const value = record ? record.value : await legacy.getItem(key);
      reads.set(key, { revision: record?.revision ?? 0, legacyValue: record ? undefined : value });
      return value ?? null;
    },
    async setItem(key, value) {
      const expected = reads.get(key);
      if (!expected) throw conflict();
      if (!expected.revision && await legacy.getItem(key) !== expected.legacyValue) throw conflict();
      const db = await database();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        let failure;
        const request = store.get(key);
        request.onsuccess = () => {
          if ((request.result?.revision ?? 0) !== expected.revision) { failure = conflict(); tx.abort(); return; }
          try { store.put({ revision: expected.revision + 1, value }, key); }
          catch (error) {
            failure = storageError('Не удалось сохранить данные демо. Предыдущие записи не изменены. Попробуйте ещё раз.', error);
            tx.abort();
          }
        };
        tx.oncomplete = () => { reads.set(key, { revision: expected.revision + 1 }); resolve(); };
        tx.onabort = tx.onerror = () => reject(failure ?? storageError(
          'Не удалось сохранить данные демо. Предыдущие записи не изменены. Попробуйте ещё раз; если ошибка повторится, проверьте доступное место в браузере.', tx.error));
      });
    },
  };
}
