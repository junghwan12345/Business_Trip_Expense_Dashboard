const DB_NAME = "personal-dashboard-v1";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "dashboard";

function openDashboardDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, callback) {
  return openDashboardDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = callback(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      })
  );
}

export function loadStateFromDb() {
  return runTransaction("readonly", (store) => store.get(STATE_KEY));
}

export function saveStateToDb(state) {
  return runTransaction("readwrite", (store) => store.put(state, STATE_KEY));
}
