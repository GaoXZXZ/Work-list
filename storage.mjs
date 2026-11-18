import { empty, merge, validate } from './model.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const iterations = 600_000;
const file = 'work-journal.enc.json';
const random = length => crypto.getRandomValues(new Uint8Array(length));
const base64 = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};
const bytes = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function seal(key, value) {
  const iv = random(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: base64(iv), data: base64(new Uint8Array(cipher)) };
}

async function unseal(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) }, key, bytes(box.data));
  return JSON.parse(decoder.decode(plain));
}

export async function makePassword(password) {
  const salt = random(16);
  return { salt: base64(salt), proof: await seal(await derive(password, salt), 'work-journal-operation-v1') };
}

export async function checkPassword(password, record) {
  try {
    return await unseal(await derive(password, bytes(record.salt)), record.proof) === 'work-journal-operation-v1';
  } catch {
    return false;
  }
}

export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('work-journal-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('journal');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export function read(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('journal').objectStore('journal').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// A read and its mutation share one IndexedDB transaction across tabs and windows.
export function update(db, key, mutate) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('journal', 'readwrite');
    const store = transaction.objectStore('journal');
    const request = store.get(key);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || Error('本机保存已取消'));
    request.onsuccess = () => {
      try {
        const next = mutate(request.result);
        if (next === undefined) return;
        store.put(next, key);
        result = next;
      } catch (error) {
        reject(error);
        transaction.abort();
      }
    };
  });
}

export async function saveDeviceConfig(db, name, config) {
  let box = null;
  if (config) {
    let key = await read(db, 'device-key');
    if (!key) {
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      key = await update(db, 'device-key', old => old || candidate);
    }
    box = await seal(key, config);
  }
  await update(db, name, () => box);
}

export async function loadDeviceConfig(db, name) {
  const box = await read(db, name);
  return box ? unseal(await read(db, 'device-key'), box) : null;
}

export function normalizeRepo(input) {
  const repo = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/i, '');
  if (!/^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(repo) || /\/(\.|\.\.)$/.test(repo)) {
    throw Error('仓库格式应为 用户名/仓库名');
  }
  return repo.toLowerCase();
}

const canonical = state => JSON.stringify(merge(state, state));

export async function connect(config, request = fetch) {
  const repo = normalizeRepo(config.repo);
  const url = 'https://api.github.com/repos/' + repo;
  const keySalt = await crypto.subtle.digest('SHA-256', encoder.encode('work-journal-cloud-v1/' + repo));
  const key = await derive(config.password, keySalt);
  let lastSha, lastRemote;

  async function call(path, options = {}) {
    const { allowMissing = false, accept = 'application/vnd.github+json', body } = options;
    const response = await request(url + path, {
      method: body ? 'PUT' : 'GET', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout?.(15_000),
      headers: {
        Accept: accept, Authorization: 'Bearer ' + config.token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (response.ok) return response;
    if (response.status === 404 && allowMissing) return null;
    const messages = {
      401: 'GitHub 令牌已失效，请在设置中更新。',
      403: 'GitHub 拒绝访问，请检查令牌权限或稍后重试。',
      404: '找不到私有仓库，请检查仓库名和令牌权限。',
      409: '云端有新提交，稍后会重新合并。',
      422: 'GitHub 拒绝写入，请检查仓库和分支的写入权限。',
      429: 'GitHub 请求受限，稍后会自动重试。',
    };
    const error = Error(messages[response.status] || `GitHub 请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }

  async function checkRepo() {
    const repoInfo = await (await call('')).json();
    if (repoInfo.private !== true) throw Error('请选择 GitHub 私有仓库。');
  }

  async function pull() {
    const result = await call('/contents/' + file, { allowMissing: true, accept: 'application/vnd.github.object+json' });
    if (!result) return { sha: null, state: empty() };
    const entry = await result.json();
    if (entry.type !== 'file' || !/^[a-f0-9]{40,64}$/i.test(entry.sha)) throw Error('云端文件格式有误。');
    if (entry.sha === lastSha) return { sha: lastSha, state: lastRemote };
    const packed = entry.encoding === 'base64'
      ? JSON.parse(decoder.decode(bytes(entry.content)))
      : await (await call('/git/blobs/' + entry.sha, { accept: 'application/vnd.github.raw+json' })).json();
    if (packed.app !== 'work-journal' || packed.version !== 1) throw Error('云端文件不是本应用的加密记录。');
    let state;
    try {
      state = await unseal(key, packed);
    } catch {
      throw Error('云同步口令有误，请使用首次连接该仓库时设置的口令。');
    }
    if (!validate(state)) throw Error('云端记录格式有误。');
    lastSha = entry.sha;
    lastRemote = state;
    return { sha: lastSha, state };
  }

  async function sync(reconcile, isCurrent = () => true, initialize = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isCurrent()) return;
      await checkRepo();
      const remote = await pull();
      if (!isCurrent()) return;
      const local = structuredClone(await reconcile(structuredClone(remote.state)));
      if ((!initialize || remote.sha) && canonical(local) === canonical(remote.state)) return;
      const packed = { app: 'work-journal', version: 1, ...await seal(key, local) };
      if (!isCurrent()) return;
      try {
        const result = await call('/contents/' + file, {
          body: {
            message: 'Sync encrypted work journal', content: base64(encoder.encode(JSON.stringify(packed))),
            ...(remote.sha && { sha: remote.sha }),
          },
        });
        lastSha = (await result.json()).content?.sha;
        lastRemote = local;
        return;
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === 2) throw error;
      }
    }
  }

  return { sync };
}
