const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compiles the app's TypeScript modules on the fly. Relative imports load the
// app's own files; native and React modules come from `mocks`, so storage and
// network code runs in Node. Each call gets fresh module state.
function createLoader(mocks = {}) {
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const base = path.join(__dirname, `../${name}`);
    const file = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate));
    const source = fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const moduleExports = {};
    cache[name] = moduleExports;
    const resolve = (request) => {
      if (request.startsWith('./')) return load(request.slice(2));
      if (request in mocks) return mocks[request];
      // Native modules of the standalone build are absent, as in Expo Go.
      if (request === 'expo-modules-core') return { requireOptionalNativeModule: () => null };
      // Native modules not under test resolve to an empty module.
      return {};
    };
    new Function('exports', 'require', compiled)(moduleExports, resolve);
    return moduleExports;
  }
  return load;
}

// AsyncStorage kept in a Map. `failWrites` and `failReads` make the next
// calls reject, as a full or broken store does on the phone.
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    data,
    failReads: false,
    failWrites: false,
    writes: [],
    async getItem(key) {
      if (storage.failReads) throw new Error('read failed');
      return data.has(key) ? data.get(key) : null;
    },
    async setItem(key, value) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (storage.failWrites) throw new Error('write failed');
      storage.writes.push([key, value]);
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
    async multiGet(keys) {
      if (storage.failReads) throw new Error('read failed');
      return keys.map((key) => [key, data.has(key) ? data.get(key) : null]);
    },
    async multiSet(pairs) {
      if (storage.failWrites) throw new Error('write failed');
      for (const [key, value] of pairs) data.set(key, value);
    },
    async getAllKeys() {
      if (storage.failReads) throw new Error('read failed');
      return [...data.keys()];
    },
    async multiRemove(keys) {
      for (const key of keys) data.delete(key);
    },
  };
  return storage;
}

function appMocks(storage) {
  return {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    react: { useEffect() {}, useSyncExternalStore: (_subscribe, get) => get() },
    'react-native': { Platform: { OS: 'ios' }, Linking: {} },
  };
}

module.exports = { createLoader, memoryStorage, appMocks };
