

export class DownloadManager {
    constructor(debug) {
        this.debug = debug;
        this.baseUrl = 'https://huggingface.co/lagunablublu/test_shards/resolve/main';
        this.maxConcurrentDownloads = Math.max(2, Math.min(4, 
            Math.floor((navigator.deviceMemory || 4) / 2)
        ));
    }


    async downloadSingleShard(shardName, progressCallback) {
        const url = `${this.baseUrl}/${shardName}`;
        const response = await fetch(url, {
            headers: {
                'Accept-Encoding': 'gzip, deflate, br'
            }
                                            });
        if (!response.ok) {
            throw new Error(`Failed to download ${shardName}: ${response.statusText}`);
        }
        const contentLength = parseInt(response.headers.get('content-length') || '0');
        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (progressCallback) {
                progressCallback(shardName, receivedLength, contentLength);
            }
        }
        const allChunks = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
        }
        return { name: shardName, buffer: allChunks.buffer };
    }


    async downloadShards(progressCallback) {
        const shardNames = [
            'weights_part001.bin',
            'weights_part002.bin',
            'weights_part003.bin',
            'weights_part004.bin',
            'weights_part005.bin',
            'weights_part006.bin',
            'weights_part007.bin',
            'adaptation_weights.bin'
        ];
        const downloadedShards = new Map();
        for (let i = 0; i < shardNames.length; i += this.maxConcurrentDownloads) {
            const batch = shardNames.slice(i, i + this.maxConcurrentDownloads);
            const batchPromises = batch.map(shardName => 
                this.downloadSingleShard(shardName, progressCallback)
                    .catch(error => {
                        throw new Error(`Failed to download ${shardName}: ${error.message}`);
                    })
            );
            const results = await Promise.all(batchPromises);
            results.forEach(({name, buffer}) => downloadedShards.set(name, buffer));
            if (window.gc) window.gc();
        }
        return downloadedShards;
    }

}