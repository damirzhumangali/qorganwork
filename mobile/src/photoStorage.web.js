import { storedMedia } from './browserStorage';

export async function openPhotoStorage(scope, retained) {
  const cache = new Map();
  const key = event => `pending:${scope}:${event.eventId}`;
  for (const event of retained) {
    const base64 = await storedMedia('get', key(event));
    if (base64) cache.set(event.eventId, base64);
  }
  return {
    uri: event => cache.has(event.eventId)
      ? `data:image/${event.photoExtension === 'png' ? 'png' : 'jpeg'};base64,${cache.get(event.eventId)}` : undefined,
    read: event => storedMedia('get', key(event)),
    async save(event, base64) { await storedMedia('put', key(event), base64); cache.set(event.eventId, base64); },
    async remove(event) { cache.delete(event.eventId); await storedMedia('delete', key(event)).catch(() => {}); },
  };
}
