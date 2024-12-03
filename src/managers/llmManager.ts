import { ModelLoader } from '../model/modelLoader.js';
import { LlmInference } from '../libs/genai_bundle.mjs';

declare global {
    interface Window {
        ModuleFactory: any;
        gc?: () => void;
        genaiModule?: {
            FilesetResolver: any;
            LlmInference: any;
        };
    }
}

interface Performance {
    memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
    };
}

interface Link {
    id: number;
    text: string;
    context?: {
        surrounding?: string;
        isInHeading?: boolean;
        isInMain?: boolean;
        isInNav?: boolean;
        position?: {
            isVisible?: boolean;
            top?: number;
        };
        score?: number;
    };
}

export class LLMManager {
    private currentInference: Promise<any> | null = null;
    private currentRequestId: number | null = null;

    private llmInference!: LlmInference;
    private loraModel: any = null;
    private debug: HTMLElement;
    private initRetryCount: number = 0;
    private readonly MAX_RETRIES = 3;
    private modelLoader: ModelLoader;
    private onStatusUpdate: (message: string, isLoading?: boolean) => void;

    constructor(debugElement: HTMLElement, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.debug = debugElement;
        this.modelLoader = new ModelLoader(this.debug);
        this.onStatusUpdate = statusCallback;
    }

    public getLLMInference() {
        return this.llmInference;
    }

    public getLoraModel() {
        return this.loraModel;
    }

    public async initialize(): Promise<void> {
        await this.setupWebAssembly();
        await this.loadGenAIBundle();
        await this.safeInitialize();
        
        if (!this.llmInference) {
            throw new Error("LLM initialization failed");
        }
    }

    private async setupWebAssembly(): Promise<void> {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.textContent = `
            if (typeof WebAssembly === 'object') {
                WebAssembly.compileStreaming = WebAssembly.compileStreaming || 
                    async function(response) {
                        const buffer = await response.arrayBuffer();
                        return WebAssembly.compile(buffer);
                    };
            }
        `;
        document.head.appendChild(script);
    }

    private patchWebGPU(): void {
        if (!navigator.gpu) return;
        const originalRequestAdapter = navigator.gpu.requestAdapter;
        navigator.gpu.requestAdapter = async function (...args): Promise<any | null> {
            const adapter = await originalRequestAdapter.apply(this, args);
            if (!adapter) return null;
            adapter.requestAdapterInfo = function (): Promise<{ vendor: string; architecture: string }> {
                return Promise.resolve(this.info || { vendor: "unknown", architecture: "unknown" });
            };
            const originalRequestDevice = adapter.requestDevice;
            adapter.requestDevice = async function (...deviceArgs): Promise<any | null> {
                const device = await originalRequestDevice.apply(this, deviceArgs);
                if (!device) return null;
                let adapterInfoValue: { vendor: string; architecture: string } | null = null;
                Object.defineProperty(device, "adapterInfo", {
                    get: function () {
                        return adapterInfoValue || adapter.info || { vendor: "unknown", architecture: "unknown" };
                    },
                    set: function (value) {
                        adapterInfoValue = value;
                        return true;
                    },
                    configurable: true,
                    enumerable: true,
                });
                return device;
            };
            return adapter;
        };
    }

    public async loadGenAIBundle(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                const genaiWasmPath = chrome.runtime.getURL('libs/genai_wasm_internal.js');
                const wasmScript = document.createElement('script');
                wasmScript.src = genaiWasmPath;
                wasmScript.type = 'text/javascript';
                const nonce = crypto.randomUUID();
                wasmScript.nonce = nonce;
                
                await new Promise<void>((resolveWasm, rejectWasm) => {
                    wasmScript.onload = () => resolveWasm();
                    wasmScript.onerror = (e) => rejectWasm(new Error(`Failed to load WASM internal: ${e}`));
                    document.head.appendChild(wasmScript);
                });

                try {
                    const moduleUrl = chrome.runtime.getURL('libs/genai_bundle.mjs');
                    const module = await import(moduleUrl);
                    if (module) {
                        window.genaiModule = module;
                        resolve();
                    } else {
                        throw new Error('Module loaded but contents are missing');
                    }
                } catch (importError) {
                    throw new Error(`Failed to import main module: ${importError.message}`);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                reject(new Error(`Failed to load GenAI bundle: ${errorMessage}`));
            }
        });
    }

    private async initializeLLM(): Promise<void> {
        try {
            if (!navigator.gpu) {
                throw new Error('WebGPU not available');
            }
            
            this.patchWebGPU();
            
            if (!window.genaiModule) {
                throw new Error('GenAI module not loaded');
            }

            const { FilesetResolver, LlmInference } = window.genaiModule;
            const genaiPath = chrome.runtime.getURL('libs');
            
            const [adapter, genai, modelBlobUrl] = await Promise.all([
                navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
                FilesetResolver.forGenAiTasks(genaiPath),
                this.modelLoader.loadShardedWeights()
            ]);

            if (!adapter) throw new Error('No WebGPU adapter found');

            const device = await adapter.requestDevice({
                requiredLimits: {
                    maxBindGroups: 4,
                    maxBindingsPerBindGroup: 8,
                    maxBufferSize: 256 * 1024 * 1024,
                    maxComputeInvocationsPerWorkgroup: 128,
                    maxComputeWorkgroupSizeX: 128,
                    maxComputeWorkgroupSizeY: 128,
                    maxComputeWorkgroupsPerDimension: 16384,
                    maxStorageBufferBindingSize: 128 * 1024 * 1024
                }
            });

            if (!device) throw new Error('Failed to create WebGPU device');

            this.llmInference = await LlmInference.createFromOptions(genai, {
                baseOptions: {
                    modelAssetPath: modelBlobUrl,
                    delegate: {
                        gpu: {
                            modelType: 'F16',
                            allowPrecisionLoss: true,
                            enableQuantization: true,
                            cacheMode: 'AGGRESSIVE',
                            waitType: 'PASSIVE',
                            preferCache: true,
                            optimizationHints: {
                                enableFastMath: true,
                                preferSmallBuffers: true,
                                computeUnit: 'GPU_AND_CPU'
                            }
                        }
                    }
                },
                maxTokens: 1000,
                topK: 3,
                temperature: 0.8,
                randomSeed: 101,
                loraRanks: [4, 8, 16, 32],
                computeSettings: {
                    numThreads: navigator.hardwareConcurrency || 4,
                    enableMemoryPlanning: true
                }
            });

            if (!this.llmInference) throw new Error('LLM creation returned null');

            const loraBlobUrl = await this.modelLoader.loadLoraWeights();
            this.loraModel = await this.llmInference.loadLoraModel(loraBlobUrl);
            
            URL.revokeObjectURL(modelBlobUrl);
            URL.revokeObjectURL(loraBlobUrl);
            if (window.gc) window.gc();
            
        } catch (error) {
            console.error(`Initialization error: ${error.message}`, error);
            throw error;
        }
    }

    public async safeInitialize(): Promise<void> {
        const memoryMonitor = setInterval(() => {
            if ((window.performance as Performance)?.memory) {
                const memory = (window.performance as Performance).memory;
            }
        }, 5000);

        try {
            await this.initializeLLM();
        } catch (error) {
            if (this.initRetryCount < this.MAX_RETRIES) {
                this.initRetryCount++;    
                if (window.gc) window.gc();
                await new Promise(resolve => setTimeout(resolve, 2000 * this.initRetryCount));
                await this.safeInitialize();
            } else {
                throw error;
            }
        } finally {
            clearInterval(memoryMonitor);
        }
    }


    
    public async getLLMRanking(links: Link[], requestId: number): Promise<number[]> {
        if (this.currentInference) {
            await this.currentInference;
        }
    
        const prompt = `Rank these webpage links by importance (1-10), returning IDs as you analyze each one.
    Links to rank:
    ${links.slice(0, 10).map(link => {
        const context = link.context?.surrounding?.slice(0, 100) || '';
        const location = link.context?.isInHeading ? '[heading]' : 
                        link.context?.isInMain ? '[main]' : '';
        return `${link.id}: ${link.text} ${location}\nContext: ${context}\n`;
    }).join('\n')}
    
    Return rankings immediately as: ID:RANK (e.g. "5:9")`;
    
        const rankings = new Map<number, number>();
        let currentPartialResponse = '';
        let fallbackUsed = false;
    
        try {
            this.currentRequestId = requestId;
            
            // Start fallback timer
            const fallbackTimeout = setTimeout(() => {
                if (rankings.size === 0) {
                    fallbackUsed = true;
                    const fallbackRanks = this.getFallbackRanking(links);
                    fallbackRanks.forEach((id, index) => {
                        const rank = Math.max(1, Math.floor((1 - index / fallbackRanks.length) * 10));
                        this.updateLinkRanking(links, id, rank, requestId);
                    });
                }
            }, 5000);
    
            this.currentInference = this.streamResponse(prompt, (partial) => {
                if (requestId !== this.currentRequestId || fallbackUsed) return;
                
                currentPartialResponse += partial;
                const matches = currentPartialResponse.matchAll(/(\d+):(\d+)/g);
                
                for (const match of matches) {
                    const id = parseInt(match[1]);
                    const rank = parseInt(match[2]);
                    if (!isNaN(id) && !isNaN(rank) && id < links.length && rank >= 1 && rank <= 10) {
                        rankings.set(id, rank);
                        this.updateLinkRanking(links, id, rank, requestId);
                    }
                }
                
                // Keep only last incomplete line
                currentPartialResponse = currentPartialResponse.split('\n').pop() || '';
            });
            await this.currentInference;
            clearTimeout(fallbackTimeout);
    
            // Fill missing ranks with fallback if needed
            if (rankings.size < links.length && !fallbackUsed) {
                const remainingLinks = links.filter(link => !rankings.has(link.id));
                const fallbackRanks = this.getFallbackRanking(remainingLinks);
                fallbackRanks.forEach((id, index) => {
                    const rank = Math.max(1, Math.floor((1 - index / fallbackRanks.length) * 10));
                    this.updateLinkRanking(links, id, rank, requestId);
                });
            }
    
            return Array.from(rankings.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([id]) => id);
        } catch (error) {
            console.warn(`[LLMManager] LLM ranking failed for #${requestId}:`, error);
            return this.getFallbackRanking(links);
        } finally {
            this.currentInference = null;
        }
    }
    
    private updateLinkRanking(links: Link[], id: number, rank: number, requestId: number): void {
        const link = links.find(l => l.id === id);
        if (link) {
            link.score = rank / 10;
            this.onStatusUpdate(`Ranked link: ${link.text.slice(0, 30)}...`, true);
            this.sendPartialUpdate(links, requestId);
        }
    }
    
    private async sendPartialUpdate(links: Link[], requestId: number): Promise<void> {
        const sortedLinks = [...links].sort((a, b) => b.score - a.score);
        chrome.runtime.sendMessage({
            type: 'PARTIAL_LINKS_UPDATE',
            links: sortedLinks,
            requestId
        });
    }
    private getFallbackRanking(links: Link[]): number[] {
        // Score links based on multiple factors
        const scoredLinks = links.map((link, id) => ({
            id,
            score: this.calculateLinkScore(link)
        }));
    
        // Sort by score and return IDs
        return scoredLinks
            .sort((a, b) => b.score - a.score)
            .map(link => link.id);
    }
    
    private calculateLinkScore(link: Link): number {
        let score = 0;
        
        // Position weight
        if (link.context?.position?.isVisible) score += 0.3;
        if ((link.context?.position?.top ?? Infinity) < 500) score += 0.2;
        
        // Context weight
        if (link.context?.isInHeading) score += 0.25;
        if (link.context?.isInMain) score += 0.15;
        if (!link.context?.isInNav) score += 0.1; // Navigation links often less important
        
        // Content weight
        if (link.text.length > 10) score += 0.1;
        if (link.context?.surrounding && link.context.surrounding.length > 50) score += 0.1;
        
        return score;
    }
    
      private async streamResponse(prompt: string, updateCallback: (text: string) => void): Promise<void> {
        let fullResponse = '';
        let textBuffer = '';
        try {
        await this.llmInference.generateResponse(
            prompt,
            (partialResult: string, done: boolean) => {
                textBuffer += partialResult;
                if (done || textBuffer.length > 1024) {
                    fullResponse += textBuffer;
                    updateCallback(fullResponse);
                    textBuffer = '';
                    console.log(`[LLMManager] Streaming response: ${fullResponse.length} chars`);
                    console.log(`[LLMManager] Streaming response: ${fullResponse}`);

                }
            }
            
        );
        } catch (error) {
          console.error('[LLMManager] Error during streaming response:', error);
          throw error;
        }
}
}