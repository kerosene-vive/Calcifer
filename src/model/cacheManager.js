import { DownloadManager } from './downloadManager.js';

export class CacheManager {
    constructor(debug) {
        this.debug = debug;
        this.dbName = 'ModelCache';
        this.dbVersion = 1;
        this.modelStore = 'modelShards';
        this.metadataStore = 'metadata';
        this.db = null;
        this.downloadManager = new DownloadManager(debug);
        if (chrome.runtime?.onSuspend) {
            chrome.runtime.onSuspend.addListener(() => {
                this.clearCache();
            });
        }
    }


    async ensureDB() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = () => reject(new Error('Failed to open database'));
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.modelStore)) {
                    db.createObjectStore(this.modelStore);
                }
                if (!db.objectStoreNames.contains(this.metadataStore)) {
                    db.createObjectStore(this.metadataStore);
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                this.db.onversionchange = () => {
                    this.db.close();
                    this.db = null;
                };
                resolve(this.db);
            };
        });
    }


    async checkCache() {
        try {
            const db = await this.ensureDB();
            return new Promise((resolve) => {
                const transaction = db.transaction([this.metadataStore, this.modelStore], 'readonly');
                const metadataStore = transaction.objectStore(this.metadataStore);
                const modelStore = transaction.objectStore(this.modelStore);
                const metadataRequest = metadataStore.get('modelVersion');
                const countRequest = modelStore.count();
                transaction.oncomplete = () => {
                    const isValid = metadataRequest.result === '1.0' && countRequest.result === 8;
                    resolve(isValid);
                };
                transaction.onerror = () => resolve(false);
            });
        } catch (error) {
            return false;
        }
    }


    async cacheShards(progressCallback) {
        try {
            const db = await this.ensureDB();
            const downloadedShards = await this.downloadManager.downloadShards(progressCallback);
            const shardNames = Array.from(downloadedShards.keys()).sort();
            for (const shardName of shardNames) {
                const buffer = downloadedShards.get(shardName);
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(this.modelStore, 'readwrite');
                    const store = transaction.objectStore(this.modelStore);
                    const request = store.put(buffer, shardName);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(new Error(`Failed to cache ${shardName}`));
                });
                downloadedShards.delete(shardName);
                if (window.gc) window.gc();
            }
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(this.metadataStore, 'readwrite');
                const store = transaction.objectStore(this.metadataStore);
                store.put('1.0', 'modelVersion');
                store.put(Date.now(), 'lastUpdate');
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(new Error('Failed to store metadata'));
            });
        } catch (error) {
            await this.clearCache().catch(() => {});
            throw new Error(`Caching failed: ${error.message}`);
        }
    }


    async retrieveShards() {
        try {
            const db = await this.ensureDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.modelStore, 'readonly');
                const store = transaction.objectStore(this.modelStore);
                const shards = {
                    model: [],
                    lora: null
                };
                for (let i = 1; i <= 7; i++) {
                    const shardName = `weights_part${String(i).padStart(3, '0')}.bin`;
                    const request = store.get(shardName);
                    request.onsuccess = () => {
                        if (request.result) {
                            shards.model.push(request.result);
                        }
                    };
                }
                const loraRequest = store.get('adaptation_weights.bin');
                loraRequest.onsuccess = () => {
                    shards.lora = loraRequest.result;
                };
                transaction.oncomplete = () => {
                    if (shards.model.length === 7 && shards.lora) {
                        resolve(shards);
                    } else {
                        reject(new Error('Incomplete cache'));
                    }
                };
                transaction.onerror = () => reject(new Error('Failed to retrieve shards'));
            });
        } catch (error) {
            throw new Error(`Retrieval failed: ${error.message}`);
        }
    }


    async clearCache() {
        try {
            const db = await this.ensureDB();
            await new Promise((resolve, reject) => {
                const transaction = db.transaction([this.modelStore, this.metadataStore], 'readwrite');
                transaction.objectStore(this.modelStore).clear();
                transaction.objectStore(this.metadataStore).clear();
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(new Error('Failed to clear cache'));
            });
            this.db.close();
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(this.dbName);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(new Error('Failed to delete database'));
            });
            this.db = null;
        } catch (error) {
            throw new Error(`Clear cache failed: ${error.message}`);
        }
    }

}