import { CacheManager } from './cacheManager.js';


export class ModelLoader {
    constructor(debug) {
        this.debug = debug;
        this.progressBars = {};
        this.cacheManager = new CacheManager(debug);
        this.CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks
        this.initializeProgressDisplay();
    }
    initializeProgressDisplay() {
        const container = document.createElement('div');
        container.style.cssText = `
            padding: 10px;
            font-family: monospace;
            font-size: 12px;
        `;
        this.debug.parentNode?.insertBefore(container, this.debug);
        this.progressContainer = container;
    }
    updateProgress(shardName, received, total) {
        if (!this.progressBars[shardName]) {
            const barContainer = document.createElement('div');
            barContainer.style.marginBottom = '10px';
            const label = document.createElement('div');
            label.textContent = shardName;
            label.style.marginBottom = '5px';
            const progress = document.createElement('div');
            progress.style.cssText = `
                width: 100%;
                height: 20px;
                background: #eee;
                border-radius: 4px;
                overflow: hidden;
            `;
            const bar = document.createElement('div');
            bar.style.cssText = `
                width: 0%;
                height: 100%;
                background: #4285f4;
                transition: width 0.3s ease;
            `;
            const percentage = document.createElement('div');
            percentage.style.cssText = `
                margin-top: 2px;
                text-align: right;
            `;
            progress.appendChild(bar);
            barContainer.appendChild(label);
            barContainer.appendChild(progress);
            barContainer.appendChild(percentage);
            this.progressContainer.appendChild(barContainer);
            this.progressBars[shardName] = { bar, percentage };
        }
        const progress = (received / total * 100).toFixed(1);
        const { bar, percentage } = this.progressBars[shardName];
        bar.style.width = `${progress}%`;
        percentage.textContent = `${progress}% (${(received / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`;
    }


    async loadShardedWeights() {
        try {
            const isCached = await this.cacheManager.checkCache();
            if (!isCached) {
                await this.cacheManager.cacheShards((shardName, received, total) => {
                        this.updateProgress(shardName, received, total);
                });
            }
            const { model: modelShards } = await this.cacheManager.retrieveShards();
            const totalSize = modelShards.reduce((sum, shard) => sum + shard.byteLength, 0);
            let processedSize = 0;
            const chunks = [];
            for (let i = 0; i < modelShards.length; i++) {
                const shard = modelShards[i];
                processedSize += shard.byteLength;
                const chunk = new Uint8Array(shard);
                chunks.push(chunk);
                const progress = (processedSize / totalSize * 100).toFixed(1);
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (window.gc) window.gc();
                }
            }
            return await this.createBlobWithProgress(chunks, totalSize);
        } catch (error) {
            const errorMsg = `Error loading model: ${error instanceof Error ? error.message : 'Unknown error'}`;
            throw new Error(errorMsg);
        } finally {
            if (this.progressContainer) {
                this.progressContainer.innerHTML = '';
            }
        }
    }


    async createBlobWithProgress(chunks, totalSize) {
        try {
            const CHUNKS_PER_GROUP = 5;
            const numGroups = Math.ceil(chunks.length / CHUNKS_PER_GROUP);
            const processedChunks = [];
            for (let i = 0; i < numGroups; i++) {
                const startIdx = i * CHUNKS_PER_GROUP;
                const endIdx = Math.min((i + 1) * CHUNKS_PER_GROUP, chunks.length);
                const groupChunks = chunks.slice(startIdx, endIdx);
                const groupBlob = new Blob(groupChunks, { type: 'application/octet-stream' });
                processedChunks.push(await groupBlob.arrayBuffer());
                const progress = (endIdx / chunks.length * 100).toFixed(1);
                await new Promise(resolve => setTimeout(resolve, 0));
                if (window.gc) window.gc();
            }
            const finalBlob = new Blob(processedChunks, { type: 'application/octet-stream' });
            if (finalBlob.size !== totalSize) {
                throw new Error(`Blob size mismatch. Expected: ${totalSize}, Got: ${finalBlob.size}`);
            }
            const blobUrl = URL.createObjectURL(finalBlob);
            return blobUrl;
        } catch (error) {
            const errorMsg = `Error creating blob: ${error instanceof Error ? error.message : 'Unknown error'}`;
            throw new Error(errorMsg);
        }
    }


    async cleanup() {
        try {
            if (window.gc) {
                window.gc();
            }
            if (this.progressContainer) {
                this.progressContainer.innerHTML = '';
            }
            this.progressBars = {};
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
        }
    }


    async loadLoraWeights() {
        try {
            const { lora } = await this.cacheManager.retrieveShards();
            if (!lora) {
                throw new Error('LoRA weights not found in cache');
            }

            return URL.createObjectURL(new Blob([lora], { 
                type: 'application/octet-stream' 
            }));
        } catch (error) {
            const errorMsg = `Error loading LoRA weights: ${error instanceof Error ? error.message : 'Unknown error'}`;
            throw new Error(errorMsg);
        }
    }

}