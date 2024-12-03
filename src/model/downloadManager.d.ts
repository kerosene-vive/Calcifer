export class DownloadManager {
    constructor(debug: HTMLElement);
    
    private debug: HTMLElement;
    private readonly baseUrl: string;
    private readonly maxConcurrentDownloads: number;

    private downloadSingleShard(
        shardName: string, 
        progressCallback?: (shardName: string, receivedLength: number, contentLength: number) => void
    ): Promise<{ name: string; buffer: ArrayBuffer }>;

    public downloadShards(
        progressCallback?: (shardName: string, receivedLength: number, contentLength: number) => void
    ): Promise<Map<string, ArrayBuffer>>;
}