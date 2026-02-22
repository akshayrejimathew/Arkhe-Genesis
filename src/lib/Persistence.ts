/**
 * Persistence.ts
 * IndexedDB storage for Chronos transaction history.
 * Enables state survival across page refreshes.
 */

import type { Commit } from './Chronos'; // ✅ FIXED: Transaction → Commit

const DB_NAME = 'ArkheGenesisDB';
const DB_VERSION = 1;
const STORE_NAME = 'transactions';

export class Persistence {
  private db: IDBDatabase | null = null;
  private ready: Promise<void>;

  constructor(private dbName: string = DB_NAME, private version: number = DB_VERSION) {
    this.ready = this.open();
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'txId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async saveTransaction(commits: Commit[]): Promise<void> { // ✅ FIXED: Transaction → Commit
    await this.ready;
    if (!this.db) throw new Error('Database not open');
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const t of commits) {
      store.put(t);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadAllTransactions(): Promise<Commit[]> { // ✅ FIXED: Transaction → Commit
    await this.ready;
    if (!this.db) throw new Error('Database not open');
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    await this.ready;
    if (!this.db) throw new Error('Database not open');
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}