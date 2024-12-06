import { CacheManager } from './cacheManager';

export class ModelLoader {
    constructor(debug: HTMLElement);
    private debug: HTMLElement;
    private progressBars: Record<string, { bar: HTMLElement; percentage: HTMLElement }>;
    private cacheManager: CacheManager;
    private readonly CHUNK_SIZE: number;
    private progressContainer: HTMLElement;

    private initializeProgressDisplay(): void;
    private updateProgress(shardName: string, received: number, total: number): void;
    public loadShardedWeights(): Promise<string>;
    private createBlobWithProgress(chunks: Uint8Array[], totalSize: number): Promise<string>;
    public cleanup(): Promise<void>;
    public loadLoraWeights(): Promise<string>;
}