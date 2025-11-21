import { ModelLoader } from '../model/modelLoader.js';
import { LlmInference, FilesetResolver, LoraModel } from '../libs/genai_bundle.mjs';

declare global {
    interface Window {
        ModuleFactory: any;
        gc?: () => void;
        genaiModule?: {
            FilesetResolver: typeof FilesetResolver;
            LlmInference: typeof LlmInference;
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

export class LLMManager {
    private static instance: LLMManager | null = null;
    private debug: HTMLElement;
    private modelLoader: ModelLoader | null = null;
    private onStatusUpdate: (message: string, isLoading?: boolean) => void;
    // Core components
    private llmInference!: LlmInference;
    private streamController: AbortController | null = null;
    private loraModel: LoraModel | null = null;
    private device: GPUDevice | null = null;
    // State management
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;
    private isDeviceLost = false;
    // Retry count for initialization
    private initRetryCount = 0;
    private readonly MAX_RETRIES = 3;

    

    static getInstance(debugElement: HTMLElement, statusCallback: (message: string, isLoading?: boolean) => void): LLMManager {
        if (!LLMManager.instance) {
            LLMManager.instance = new LLMManager(debugElement, statusCallback);
        }
        return LLMManager.instance;
    }


    public constructor(debugElement: HTMLElement, statusCallback: (message: string, isLoading?: boolean) => void) {
        this.debug = debugElement;
        this.onStatusUpdate = statusCallback;
    }


    public getLLMInference() {
        return this.llmInference;
    }


    public getLoraModel() {
        return this.loraModel;
    }


    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            try {
                this.modelLoader = new ModelLoader(this.debug);
                this.onStatusUpdate("Setting up WebAssembly...", true);
                await this.setupWebAssembly();
                this.onStatusUpdate("Loading AI models...", true);
                await this.loadGenAIBundle();
                this.patchWebGPU();
                this.onStatusUpdate("Initializing GPU...", true);
                await this.setupDevice();
                this.onStatusUpdate("Preparing model...", true);
                const adapter = await navigator.gpu.requestAdapter({
                    powerPreference: 'high-performance'
                });
                if (!adapter) throw new Error('No GPU adapter found');
                await this.initializeModel(adapter);
                this.isInitialized = true;
                this.onStatusUpdate("Ready", false);
            } catch (error) {
                this.initPromise = null;
                this.isInitialized = false;
                throw error;
            }
        })();
        return this.initPromise;
    }


    private async setupDevice(): Promise<void> {
        if (!navigator.gpu) throw new Error('WebGPU not supported');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        if (!adapter) throw new Error('No GPU adapter found');
        this.device = await adapter.requestDevice({
            requiredLimits: this.DEVICE_LIMITS
        });
        this.device?.lost.then(async () => {
            this.isDeviceLost = true;
            this.isInitialized = false;
            this.device = null;
            // Don't auto-reinitialize - wait for next request
        });
    }


    async streamResponse(
        prompt: string,
        onUpdate: (text: string, isComplete: boolean) => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        if (!this.isInitialized || this.isDeviceLost) {
            await this.initialize();
        }
        this.streamController = new AbortController();
        const signal = this.streamController.signal;
        try {
            let buffer = '';
            const processChunk = (chunk: string, isDone: boolean) => {
                if (signal.aborted) return;
                buffer += chunk;
                if (buffer.length >= 32 || isDone) {
                    onUpdate(buffer, isDone);
                    buffer = '';
                }
            };
            await this.llmInference.generateResponse(prompt, processChunk);
        } catch (error) {
            if (!signal?.aborted) {
                onError?.(error instanceof Error ? error : new Error(String(error)));
            }
        } finally {
            this.streamController = null;
        }
    }


    public cancelStream = () => {
        if (this.streamController) {
            this.streamController.abort();
            this.streamController = null;
        }
    };


    private async setupWebAssembly(): Promise<void> {
    // Directly patch WebAssembly without inline scripts
    if (typeof WebAssembly === 'object' && !WebAssembly.compileStreaming) {
        (WebAssembly as any).compileStreaming = async function(response: Response) {
            const buffer = await response.arrayBuffer();
            return WebAssembly.compile(buffer);
        };
    }
}

    private patchWebGPU(): void {
        if (!navigator.gpu) return;
        const originalRequestAdapter = navigator.gpu.requestAdapter;
        navigator.gpu.requestAdapter = async function (...args): Promise<any | null> {
            const adapter = await originalRequestAdapter.apply(this, args);
            if (!adapter) return null;
            adapter.requestAdapterInfo = function (): Promise<GPUAdapterInfo> {
                return Promise.resolve(this.info || { vendor: "unknown", architecture: "unknown", __brand: "", device: "", description: "" });
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
                const moduleUrl = chrome.runtime.getURL('libs/genai_bundle.mjs');
                const module = await import(moduleUrl);
                if (module) {
                    window.genaiModule = module;
                    resolve();
                } else {
                    throw new Error('Module loaded but contents are missing');
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                reject(new Error(`Failed to load GenAI bundle: ${errorMessage}`));
            }
        });
    }


    public async safeInitialize(): Promise<void> {
        const memoryMonitor = setInterval(() => {
            if ((window.performance as Performance)?.memory) {
                const memory = (window.performance as Performance).memory;
                // Memory monitoring logic here if needed
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
    

    async streamResponseWithFallback(
            prompt: string,
            onUpdate: (text: string, isComplete: boolean) => void,
            onError?: (error: Error) => void
        ): Promise<void> {
            try {
                await this.streamResponse(prompt, onUpdate, onError);
            } catch (error) {
                // Fallback to simpler processing if optimized version fails
                try {
                    const result = await this.llmInference.generateResponse(prompt);
                    onUpdate(result, true);
                } catch (fallbackError) {
                    onError?.(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
                }
            }
        }
    

    private setupDeviceLostHandler(device: GPUDevice) {
        device.lost.then((info) => {
            console.error('WebGPU device lost:', info);
            this.isDeviceLost = true;
            this.device = null;
            // Optionally trigger device recreation
            this.reinitializeDevice();
        });
    }


    private async initializeModel(adapter: GPUAdapter): Promise<void> {
        if (!window.genaiModule) throw new Error('GenAI module not loaded');
        if (!this.device) throw new Error('GPU device not initialized');
        const genaiPath = chrome.runtime.getURL('libs');
        const [genai, modelBlobUrl] = await Promise.all([
            FilesetResolver.forGenAiTasks(genaiPath),
            this.modelLoader?.loadShardedWeights() ?? Promise.reject(new Error('ModelLoader is null'))
        ]);
        try {
            // Configure based on actual model parameters from logs
            this.llmInference = await LlmInference.createFromOptions(genai, {
                baseOptions: {
                    modelAssetPath: modelBlobUrl,
                    delegate: "GPU",
                    gpuOptions: {
                        device: this.device,
                        adapterInfo: await adapter.requestAdapterInfo()
                    }
                },
                maxTokens: 1000,
                topK: 3,
                temperature: 0.8,
                loraRanks: [4, 8, 16, 32]
            });
            if (!this.llmInference) {
                throw new Error('LLM creation returned null');
            }
            if (!this.modelLoader) {
                throw new Error('ModelLoader is null');
            }
            const loraBlobUrl = await this.modelLoader.loadLoraWeights();
            try {
                this.loraModel = await this.llmInference.loadLoraModel(loraBlobUrl);
            } catch (error) {
                console.warn('LoRA loading failed, continuing without LoRA:', error);
            }
        } catch (error) {
            console.error('Model initialization failed:', error);
            throw error;
        } finally {
            URL.revokeObjectURL(modelBlobUrl);
            if (this.loraModel) {
            if (!this.modelLoader) {
                throw new Error('ModelLoader is null');
            }
                const loraBlobUrl = await this.modelLoader.loadLoraWeights();
                if (this.loraModel) {
                    URL.revokeObjectURL(loraBlobUrl);
                }
            }
            if (window.gc) window.gc();
        }
    }
        private readonly DEVICE_LIMITS = {
        maxBindGroups: 4,
        maxBindingsPerBindGroup: 8,
        maxBufferSize: 128 * 1024 * 1024,  // 128MB for better stability
        maxComputeInvocationsPerWorkgroup: 128,
        maxComputeWorkgroupSizeX: 128,
        maxComputeWorkgroupSizeY: 128,
        maxComputeWorkgroupsPerDimension: 16384,
        maxStorageBufferBindingSize: 64 * 1024 * 1024  // 64MB for stability
    };


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
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });
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
            if (!this.device) throw new Error('Failed to create WebGPU device');
            this.setupDeviceLostHandler(this.device);
            const [genai, modelBlobUrl] = await Promise.all([
                FilesetResolver.forGenAiTasks(genaiPath),
                this.modelLoader?.loadShardedWeights() ?? Promise.reject(new Error('ModelLoader is null'))
            ]);
            this.llmInference = await LlmInference.createFromOptions(genai, {
                baseOptions: {
                    modelAssetPath: modelBlobUrl,
                    delegate: "GPU",
                    gpuOptions: {
                        device: this.device
                    }
                },
                maxTokens: 1000,
                topK: 3,
                temperature: 0.8,
                randomSeed: 101,
                loraRanks: [4, 8, 16, 32],
                
            });

            if (!this.llmInference) throw new Error('LLM creation returned null');
            if (!this.modelLoader) {
                throw new Error('ModelLoader is null');
            }
            const loraBlobUrl = await this.modelLoader.loadLoraWeights();
            this.loraModel = await this.llmInference.loadLoraModel(loraBlobUrl);
            URL.revokeObjectURL(modelBlobUrl);
            URL.revokeObjectURL(loraBlobUrl);
            if (window.gc) window.gc();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`LLM initialization failed: ${errorMessage}`);
        }
    }


    private async reinitializeDevice(): Promise<void> {
        try {
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });
            if (!adapter) throw new Error('No WebGPU adapter found');
            this.device = await adapter.requestDevice({
                requiredLimits: {
                    maxBindGroups: 4,
                    maxBindingsPerBindGroup: 8,
                    maxBufferSize: 256 * 1024 * 1024,
                    maxComputeInvocationsPerWorkgroup: 256, // Increased for better performance
                    maxComputeWorkgroupSizeX: 256,
                    maxComputeWorkgroupSizeY: 256,
                    maxComputeWorkgroupsPerDimension: 65536,
                    maxStorageBufferBindingSize: 256 * 1024 * 1024
                }
            });
            if (this.device) {
                this.device.lost.then(async (info) => {
                    console.warn('WebGPU device lost:', info);
                    this.isDeviceLost = true;
                    this.device = null;
                    try {
                        await this.reinitializeDevice();
                        this.isDeviceLost = false;
                    } catch (error) {
                        console.error('Failed to recover device:', error);
                    }
                });
            }
        } catch (error) {
            console.error('Device reinitialization failed:', error);
            throw error;
        }
    }

}
