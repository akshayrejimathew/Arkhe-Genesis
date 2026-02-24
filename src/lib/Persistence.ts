/**
 * Persistence.ts
 * IndexedDB storage for Chronos transaction history.
 * Enables state survival across page refreshes.
 *
 * FIX 1 — Write-Queue Mutex (2026-02-22):
 *   Rapid saveTransaction calls (e.g. 100 fast mutations) previously opened
 *   overlapping IDBTransaction objects on the same store. IndexedDB does not
 *   allow concurrent readwrite transactions on the same store; the second
 *   transaction either blocks until the first commits or — on some UA
 *   implementations — silently aborts, losing the batch.
 *
 *   Fix: every saveTransaction call is chained onto a private `writeQueue`
 *   Promise. Each call waits for the preceding write to settle (resolve or
 *   reject) before opening a new IDBTransaction. This guarantees strict
 *   serial ordering with zero silent data loss.
 *
 *   The swallow-on-error tail (`this.writeQueue = next.catch(() => {})`)
 *   ensures a single failed write never stalls the entire queue — the next
 *   caller still gets to run.
 */

import type { Commit } from './Chronos';

const DB_NAME = 'ArkheGenesisDB';
const DB_VERSION = 1;
const STORE_NAME = 'transactions';

export class Persistence {
  private db: IDBDatabase | null = null;
  private ready: Promise<void>;

  /**
   * Write-queue mutex — all saveTransaction calls are serialized through this
   * chain so that no two IDBTransaction objects are ever open simultaneously
   * on the same object store in readwrite mode.
   */
  private writeQueue: Promise<void> = Promise.resolve();

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

  /**
   * Enqueue a write operation.
   *
   * The returned Promise resolves when THIS batch has been committed.
   * It rejects if the underlying IDBTransaction fails, but the queue
   * itself is never permanently blocked — the tail catch swallows the
   * error so subsequent calls can still proceed.
   */
  async saveTransaction(commits: Commit[]): Promise<void> {
    // Chain this write onto the end of any in-flight write.
    const next = this.writeQueue.then(() => this._doSaveTransaction(commits));
    // Keep the public queue alive even if `next` rejects.
    this.writeQueue = next.catch(() => {
      /* intentionally swallowed — caller still receives the rejection via `next` */
    });
    // Return the actual result Promise so callers can await or catch it.
    return next;
  }

  /**
   * Internal: performs the actual IDB write. Called only from the serialized
   * queue, so there is always at most one readwrite transaction open at a time.
   */
  private async _doSaveTransaction(commits: Commit[]): Promise<void> {
    await this.ready;
    if (!this.db) throw new Error('Database not open');
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const t of commits) {
      store.put(t);
    }
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('IDB transaction aborted'));
    });
  }

  async loadAllTransactions(): Promise<Commit[]> {
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
    // Serialize clears through the same queue so they don't race with writes.
    const next = this.writeQueue.then(() => this._doClear());
    this.writeQueue = next.catch(() => {});
    return next;
  }

  private async _doClear(): Promise<void> {
    await this.ready;
    if (!this.db) throw new Error('Database not open');
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('IDB clear transaction aborted'));
    });
  }
}