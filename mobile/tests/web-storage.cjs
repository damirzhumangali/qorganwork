const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const babel = require('@babel/core');
const { IDBFactory } = require('fake-indexeddb');

function environment() {
  const values = new Map();
  const indexedDB = new IDBFactory();
  let failWrites = false;
  function reload(platform = 'web') {
    const modules = new Map();
    const mocks = {
      '@react-native-async-storage/async-storage': {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { if (failWrites) throw new Error('Storage full'); values.set(key, value); },
      },
      'expo-crypto': {
        CryptoDigestAlgorithm: { SHA256: 'sha256' }, randomUUID: crypto.randomUUID,
        digestStringAsync: async (algorithm, text) => crypto.createHash(algorithm).update(text).digest('hex'),
      },
      'react-native': { Platform: { OS: platform } },
      'expo-linking': { createURL: value => `qwork://${value}` },
    };
    function load(name) {
      if (mocks[name]) return mocks[name];
      const file = path.join(__dirname, '../src', name.replace(/^\.\//, '') +
        (['./browserStorage', './photoStorage'].includes(name) ? '.web.js' : '.js'));
      if (modules.has(file)) return modules.get(file).exports;
      const module = { exports: {} }; modules.set(file, module);
      const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
        configFile: false, babelrc: false,
        plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
      });
      vm.runInNewContext(code, {
        module, exports: module.exports, require: load, indexedDB, URL,
        window: { location: { origin: 'https://qwork.example' } },
        process: { env: { EXPO_PUBLIC_QWORK_API_URL: '/api', EXPO_PUBLIC_QWORK_INVITE_URL: 'https://api.example' } },
      }, { filename: file });
      return module.exports;
    }
    return load;
  }
  async function mediaKeys() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qwork-media-v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').getAllKeys();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close(); return keys;
  }
  return { values, reload, mediaKeys, failWrites: value => { failWrites = value; } };
}
const session = id => ({ company: { code: 'company-a' }, user: { id } });
const task = { id: 'task-1', title: 'Проверка', revision: 1, status: 'arrived', photos: {} };
const imageBase64 = 'iVBORw0KGgo-test-image';
async function queued(env, id = 'user-a') {
  const store = await env.reload()('./offline').openOffline(session(id));
  await store.saveTasks([task]);
  await store.enqueue(task.id, 'photo', { kind: 'before', imageBase64 });
  return store;
}

test('queued photo survives a reload and is isolated from another account', async () => {
  const env = environment();
  await queued(env);
  const reload = env.reload();
  const store = await reload('./offline').openOffline(session('user-a'));
  assert.equal(store.snapshot().pending, 1);
  assert.equal(store.pendingPhotos(task.id)[0].localUri, `data:image/png;base64,${imageBase64}`);
  assert.ok(![...env.values.values()][0].includes(imageBase64), 'photo bytes stay outside metadata storage');
  const other = await reload('./offline').openOffline(session('user-b'));
  assert.equal(other.snapshot().pending, 0);
  assert.equal(other.pendingPhotos(task.id).length, 0);
});

test('network failure keeps the photo; successful retry sends same event and removes bytes', async () => {
  const env = environment();
  const store = await queued(env);
  let sentId;
  await assert.rejects(store.flush(async (_, { body }) => { sentId = body.eventId; throw new Error('Offline'); }), /Offline/);
  assert.equal(store.snapshot().pending, 1);
  assert.ok(store.pendingPhotos(task.id)[0].localUri);
  await store.flush(async (route, { body }) => {
    assert.equal(route, '/sync/events'); assert.equal(body.eventId, sentId);
    assert.equal(body.body.imageBase64, imageBase64);
    return { task: { ...task, revision: 2, photos: { before: 1 } } };
  });
  assert.equal(store.snapshot().pending, 0);
  const scope = crypto.createHash('sha256').update(JSON.stringify(['/api', 'company-a', 'user-a'])).digest('hex');
  assert.equal(await env.reload()('./browserStorage').storedMedia('get', `pending:${scope}:${sentId}`), undefined);
});

test('failed metadata commit leaves no queued action or orphan photo', async () => {
  const env = environment(); const load = env.reload();
  const store = await load('./offline').openOffline(session('user-a'));
  await store.saveTasks([task]);
  env.failWrites(true);
  await assert.rejects(store.enqueue(task.id, 'photo', { kind: 'before', imageBase64 }), /Storage full/);
  assert.equal(store.snapshot().pending, 0);
  assert.equal(store.pendingPhotos(task.id).length, 0);
  assert.deepEqual(await env.mediaKeys(), []);
  env.failWrites(false);
  await store.enqueue(task.id, 'photo', { kind: 'before', imageBase64 });
  assert.equal(store.snapshot().pending, 1);
});

test('rejected photo remains available for replacement after reload', async () => {
  const env = environment(); const store = await queued(env);
  await store.flush(async () => { throw Object.assign(new Error('Снимок размыт'), { status: 422, code: 'photo_replaceable' }); });
  const again = await env.reload()('./offline').openOffline(session('user-a'));
  const issue = again.snapshot().issues[0];
  assert.equal(issue.replaceable, true);
  await again.replacePhoto(task.id, issue.eventId, { imageBase64: 'replacement-jpeg' });
  const updated = again.pendingPhotos(task.id)[0];
  assert.notEqual(updated.id, issue.eventId);
  assert.equal(updated.localUri, 'data:image/jpeg;base64,replacement-jpeg');
  assert.equal(again.snapshot().issues.length, 0);
});

test('web invites use this site, preserve native links and reject foreign origins', () => {
  const links = environment().reload()('./companyLink');
  const token = 'a'.repeat(43);
  assert.equal(links.createCompanyLink('abc123abc123'), 'https://qwork.example/invite/abc123abc123');
  assert.equal(links.parseCompanyLink(links.createCompanyLink('abc123abc123')), 'ABC123ABC123');
  assert.equal(links.parseCompanyLink('qwork://invite/abc123abc123'), 'ABC123ABC123');
  assert.equal(links.createEmployeeInvite(token), `https://qwork.example/join#${token}`);
  assert.equal(links.parseEmployeeInvite(links.createEmployeeInvite(token)), token);
  assert.equal(links.parseEmployeeInvite(`https://api.example/join#${token}`), token);
  assert.equal(links.parseEmployeeInvite(`https://foreign.example/join#${token}`), null);
  assert.equal(links.parseCompanyLink('https://foreign.example/invite/abc123abc123'), null);
});

test('native company links retain their app scheme', () => {
  const links = environment().reload('ios')('./companyLink');
  assert.equal(links.createCompanyLink('abc123abc123'), 'qwork://invite/abc123abc123');
});
