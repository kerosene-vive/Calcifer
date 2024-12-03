import { DownloadManager } from './downloadManager';

export class CacheManager {
    constructor(debug: HTMLElement);
    
    private debug: HTMLElement;
    private readonly dbName: string;
    private readonly dbVersion: number;
    private readonly modelStore: string;
    private readonly metadataStore: string;
    private db: IDBDatabase | null;
    private downloadManager: DownloadManager;

    private ensureDB(): Promise<IDBDatabase>;
    public checkCache(): Promise<boolean>;
    public cacheShards(progressCallback: (shardName: string, received: number, total: number) => void): Promise<void>;
    public retrieveShards(): Promise<{ model: ArrayBuffer[], lora: ArrayBuffer | null }>;
    public clearCache(): Promise<void>;
}