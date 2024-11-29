import { ModelLoader } from '../model/modelLoader.js';

export class LLMManager {
    private llmInference: any = null;
    private loraModel: any = null;
    private debug: HTMLElement;
    private initRetryCount: number = 0;
    private readonly MAX_RETRIES = 3;
    private modelLoader: ModelLoader;

    constructor(debugElement: HTMLElement) {
        this.debug = debugElement;
        this.modelLoader = new ModelLoader(this.debug);
    }

    public getLLMInference() {
        return this.llmInference;
    }

    public getLoraModel() {
        return this.loraModel;
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
}