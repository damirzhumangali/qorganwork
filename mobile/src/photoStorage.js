import { Directory, File, Paths } from 'expo-file-system';

export async function openPhotoStorage(scope, retained) {
  const folder = new Directory(Paths.document, 'qwork-offline', scope);
  const name = event => `${event.eventId}.${event.photoExtension === 'png' ? 'png' : 'jpg'}`;
  const file = event => new File(folder, name(event));
  function safeDelete(item) { try { if (item.exists) item.delete(); } catch {} }
  if (folder.exists) {
    const keep = new Set(retained.map(name));
    try { for (const item of folder.list()) if (item instanceof File && !keep.has(item.name)) safeDelete(item); } catch {}
  }
  return {
    uri: event => file(event).uri,
    read: event => file(event).base64(),
    remove: async event => safeDelete(file(event)),
    async save(event, base64) {
      folder.create({ intermediates: true, idempotent: true });
      const target = file(event);
      try { target.create(); await target.write(base64, { encoding: 'base64' }); }
      catch (error) { safeDelete(target); throw error; }
    },
  };
}
