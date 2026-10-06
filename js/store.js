// IndexedDB の薄いラッパ。ユーザーごとに別DB(アカウント間でデータが混ざらない)。
const STORES = {
  projects: { keyPath: "id" }, // 編集中・保存済みの作業データ(PDF本体+注釈)
  recents: { keyPath: "id" },  // 履歴一覧(開いた/保存したファイル)
  stamps: { keyPath: "id" },   // 登録した印影
  sigs: { keyPath: "id" },     // 登録した署名
  queue: { keyPath: "id" },    // オンライン復帰後に実行する保存・メール送信
  kv: { keyPath: "key" },      // 設定など
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function openStore(user) {
  const name = `apdf_${(user || "guest").toLowerCase()}`;
  const dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [n, o] of Object.entries(STORES)) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (store, mode, fn) => {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const r = fn(os);
      if (r) r.onsuccess = () => (result = r.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    name,
    put: (store, value) => run(store, "readwrite", (os) => os.put(value)),
    get: (store, key) => run(store, "readonly", (os) => os.get(key)),
    getAll: (store) => run(store, "readonly", (os) => os.getAll()),
    del: (store, key) => run(store, "readwrite", (os) => os.delete(key)),
    clear: (store) => run(store, "readwrite", (os) => os.clear()),
    async getSetting(key, fallback) {
      const r = await run("kv", "readonly", (os) => os.get(key));
      return r ? r.value : fallback;
    },
    setSetting: (key, value) => run("kv", "readwrite", (os) => os.put({ key, value })),
  };
}
