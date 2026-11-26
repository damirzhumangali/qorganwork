import { storedMedia } from './browserStorage';

export async function openOfflineMedia(scope, request, imageSource) {
  const inFlight = new Map();
  const urls = new Map();
  const manifestKey = id => `gallery:${scope}:${id}`;
  const fileKey = (task, photo) => `material:${scope}:${task}:${photo}`;
  async function download(task) {
    const previous = await storedMedia('get', manifestKey(task.id));
    if (previous?.revision === task.revision) return;
    const path = `/tasks/${task.id}/photos`;
    const { photos } = await request(path);
    for (const photo of photos) {
      const source = imageSource(`${path}/${photo.id}`);
      const response = await fetch(source.uri, { headers: source.headers, cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить фото.');
      await storedMedia('put', fileKey(task.id, photo.id), await response.blob());
    }
    await storedMedia('put', manifestKey(task.id), { revision: task.revision, photos });
  }
  return {
    prefetch(task) {
      if (inFlight.has(task.id)) return inFlight.get(task.id);
      const action = download(task).finally(() => inFlight.delete(task.id));
      inFlight.set(task.id, action);
      return action;
    },
    async gallery(taskId) {
      const snapshot = await storedMedia('get', manifestKey(taskId));
      if (!snapshot) return null;
      const result = [];
      for (const photo of snapshot.photos) {
        const key = fileKey(taskId, photo.id);
        const blob = await storedMedia('get', key);
        if (!blob) return null;
        if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
        result.push({ ...photo, localUri: urls.get(key) });
      }
      return result;
    },
  };
}
