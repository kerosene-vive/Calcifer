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
}

export class LLMManager {
    private currentInference: Promise<any> | null = null;
    private currentRequestId: number | null = null;

    private llmInference: LlmInference
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
        console.log(`[LLMManager] Starting LLM ranking for request #${requestId}`);
    
        // Wait for any ongoing inference to complete
        if (this.currentInference) {
          await this.currentInference;
        }
    
        let response = '';
        let cancelled = false;
        const prompt = `Rate these webpage links by importance (1-10):
    ${links.slice(0, 10).map(link => `${link.id}: ${link.text.slice(0, 50)}`).join('\n')}
    Output format: just IDs in order, most important first.`;
    
        try {
          this.currentRequestId = requestId;
          this.currentInference = this.streamResponse(
            prompt,
            (partial: string) => {
              if (requestId !== this.currentRequestId) {
                cancelled = true;
                console.log(`[LLMManager] Ranking #${requestId} cancelled mid-generation`);
                return;
              }
              response += partial;
            }
          );
          await this.currentInference;
    
          if (cancelled || requestId !== this.currentRequestId) {
            throw new Error('Request cancelled');
          }
    
          // Parse response into ranked IDs
          const rankedIds = response
            .split(/[\s,]+/)
            .map(part => part.trim())
            .map(part => part.replace(/\D+/g, ''))
            .filter(part => part.length > 0)
            .map(id => parseInt(id, 10))
            .filter(id => !isNaN(id) && id >= 0 && id < links.length);
    
          console.log(`[LLMManager] Cleaned ranked IDs for #${requestId}:`, rankedIds);
          return rankedIds;
        } catch (error) {
          console.warn(`[LLMManager] LLM ranking failed for #${requestId}:`, error);
          return [];
        } finally {
          this.currentInference = null;
        }
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