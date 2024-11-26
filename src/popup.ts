import "./popup.css";
import { ChatManager } from './chatManager';
import { UIManager } from './uiManager';
import { ModelLoader } from './modelLoader.js';
import { patchWebGPU } from './patchWebGPU'; // Import the patch function

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

interface Navigator {
    gpu?: {
        requestAdapter: (options?: { powerPreference?: 'high-performance' | 'low-power' }) => Promise<any>;
    };
    hardwareConcurrency?: number;
}
declare var navigator: Navigator;

interface Performance {
    memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
    };
}
declare var performance: Performance;

export class PopupManager {
    private chatManager: ChatManager | null = null;
    private uiManager: UIManager;
    private isFirstLoad: boolean = true;
    private llmInference: any = null;
    private loraModel: any = null;
    private debug: HTMLElement;
    private status: HTMLElement;
    private initRetryCount: number = 0;
    private readonly MAX_RETRIES = 3;
    private modelLoader: ModelLoader;
    private readonly MODULE_FACTORY_TIMEOUT = 120000; // 2 minutes
    private readonly MEMORY_THRESHOLD = 3000; // MB

    private modelData: {
        buffer: ArrayBuffer | null;
        url: string | null;
    } = { buffer: null, url: null };

    constructor() {
        this.uiManager = new UIManager();
        this.debug = document.getElementById('debug') || document.createElement('div');
        this.status = document.getElementById('status') || document.createElement('div');
        this.modelLoader = new ModelLoader(this.debug);
        this.initializeEventListeners();
        this.addStyles();
    }
    private async loadGenAIBundle(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                this.log('Starting GenAI bundle load...');
                
                // Create script elements with nonce
                const genaiWasmPath = chrome.runtime.getURL('libs/genai_wasm_internal.js');
                const wasmScript = document.createElement('script');
                wasmScript.src = genaiWasmPath;
                wasmScript.type = 'text/javascript';
                // Add a nonce
                const nonce = crypto.randomUUID();
                wasmScript.nonce = nonce;
    
                // Load WASM internal first
                await new Promise<void>((resolveWasm, rejectWasm) => {
                    wasmScript.onload = () => {
                        this.log('WASM internal loaded');
                        resolveWasm();
                    };
                    wasmScript.onerror = (e) => {
                        this.log('Failed to load WASM internal');
                        rejectWasm(new Error(`Failed to load WASM internal: ${e}`));
                    };
                    document.head.appendChild(wasmScript);
                });
    
                // Then load the main module using dynamic import
                try {
                    const moduleUrl = chrome.runtime.getURL('libs/genai_bundle.mjs');
                    this.log(`Attempting to load module from: ${moduleUrl}`);
                    
                    const module = await import(moduleUrl);
                    
                    if (module) {
                        window.genaiModule = module;
                        this.log('GenAI bundle loaded successfully');
                        resolve();
                    } else {
                        throw new Error('Module loaded but contents are missing');
                    }
                } catch (importError) {
                    this.log(`Module import error: ${importError.message}`);
                    throw new Error(`Failed to import main module: ${importError.message}`);
                }
    
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                this.log(`Error during bundle load: ${errorMessage}`);
                reject(new Error(`Failed to load GenAI bundle: ${errorMessage}`));
            }
        });
    }

    
    // Add this helper method to check module loading status
    private async checkModuleLoading(): Promise<void> {
        if (!window.genaiModule) {
            throw new Error('GenAI module not loaded');
        }
    
        const { FilesetResolver, LlmInference } = window.genaiModule;
        
        if (!FilesetResolver || !LlmInference) {
            throw new Error('Required module exports not found');
        }
    
        this.log('Module loading check passed');
    }

    public async initialize(): Promise<void> {
        try {
            this.log("Initializing application...");
            this.updateStatus("Starting initialization");
            this.isFirstLoad = true;
            
            // Add script to head to ensure module initialization
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
            
            try {
                await this.loadGenAIBundle();
                this.log("GenAI bundle loaded successfully");
            } catch (error) {
                throw new Error(`Failed to load GenAI bundle: ${error.message}`);
            }
            
            await this.safeInitialize();
            
            if (!this.llmInference) {
                throw new Error("LLM initialization failed");
            }
    
            this.chatManager = new ChatManager(this.llmInference, this.loraModel);
            await this.chatManager.initializeWithContext();
            
            this.isFirstLoad = false;
            this.updateStatus("Ready", false);
        } catch (error) {
            console.error("Error initializing PopupManager:", error);
            this.updateStatus("Initialization failed", false);
            throw error;
        }
    }

    private async initializeLLM(): Promise<void> {
        try {
            this.updateStatus('Initializing...');
            this.log('Checking WebGPU availability...');
            
            if (!navigator.gpu) {
                throw new Error('WebGPU not available');
            }
            patchWebGPU();
            if (!window.genaiModule) {
                throw new Error('GenAI module not loaded');
            }

            const { FilesetResolver, LlmInference } = window.genaiModule;

            const genaiPath = chrome.runtime.getURL('libs');
            this.updateStatus('Setting up components...');

            const [adapter, genai, modelBlobUrl] = await Promise.all([
                navigator.gpu.requestAdapter({
                    powerPreference: 'high-performance'
                }),
                FilesetResolver.forGenAiTasks(genaiPath),
                this.modelLoader.loadShardedWeights()
            ]);

            if (!adapter) {
                throw new Error('No WebGPU adapter found');
            }

            // Request device with explicit limits
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

            if (!device) {
                throw new Error('Failed to create WebGPU device');
            }

            this.log('Creating LlmInference...');
            this.updateStatus('Initializing LLM...');
            
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
                computeSettings: {
                    numThreads: navigator.hardwareConcurrency || 4,
                    enableMemoryPlanning: true
                }
            });

            if (!this.llmInference) {
                throw new Error('LLM creation returned null');
            }

            this.updateStatus('Loading LoRA model...');
            const loraBlobUrl = await this.modelLoader.loadLoraWeights();
            this.loraModel = await this.llmInference.loadLoraModel(loraBlobUrl);

            URL.revokeObjectURL(modelBlobUrl);
            URL.revokeObjectURL(loraBlobUrl);
            if (window.gc) window.gc();

            this.log('Initialization complete!');
            this.updateStatus('Ready', false);
        } catch (error) {
            const errorMessage = `Initialization error: ${error.message}`;
            this.log(errorMessage);
            console.error(errorMessage, error);
            throw error;
        }
    }
    private async cleanupModelData(): Promise<void> {
        try {
            // Cleanup URL if exists
            if (this.modelData.url) {
                URL.revokeObjectURL(this.modelData.url);
                this.modelData.url = null;
            }

            // Clear buffer reference
            this.modelData.buffer = null;

            // Optional garbage collection
            if (window.gc) {
                window.gc();
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            this.log(`Cleanup warning: ${error.message}`);
        }
    }

    private async checkMemoryUsage(): Promise<void> {
        const performanceMemory = (window.performance as Performance).memory;
        if (performanceMemory) {
            const usedHeapGB = performanceMemory.usedJSHeapSize / (1024 * 1024);
            const totalHeapGB = performanceMemory.totalJSHeapSize / (1024 * 1024);
            const heapLimit = performanceMemory.jsHeapSizeLimit / (1024 * 1024);
            
            this.log(`Memory Usage: ${usedHeapGB.toFixed(2)}MB / ${totalHeapGB.toFixed(2)}MB (Limit: ${heapLimit.toFixed(2)}MB)`);
            
            // Alert if memory usage is above 80% of limit
            if (usedHeapGB > (heapLimit * 0.8)) {
                this.log("Warning: High memory usage detected");
            }
        }
    }

    private logMemoryUsage(): void {
        if (window.performance && (window.performance as Performance).memory) {
            const memory = (window.performance as Performance).memory;
            this.log(`Memory Usage:
                Total JS Heap: ${(memory?.totalJSHeapSize ?? 0) / 1024 / 1024} MB,
                Used JS Heap: ${(memory?.usedJSHeapSize ?? 0) / 1024 / 1024} MB,
                JS Heap Size Limit: ${memory?.jsHeapSizeLimit ? memory.jsHeapSizeLimit / 1024 / 1024 : 'N/A'} MB`);
        }
    }

    private startMemoryMonitoring(): NodeJS.Timeout {
        return setInterval(() => {
            this.logMemoryUsage();
        }, 5000);
    }

    private async updateProgressWithTimeout(message: string, promise: Promise<any>, timeout: number = 30000): Promise<any> {
        let progressInterval: NodeJS.Timeout;
        let progress = 0;
        
        const progressPromise = new Promise((resolve, reject) => {
            progressInterval = setInterval(() => {
                progress += 0.1;
                if (progress <= 0.9) {
                    this.updateProgress(message, progress);
                }
            }, 1000);
    
            promise
                .then((result) => {
                    progress = 1;
                    this.updateProgress(message, progress);
                    resolve(result);
                })
                .catch(reject)
                .finally(() => clearInterval(progressInterval));
        });
    
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                clearInterval(progressInterval);
                reject(new Error(`Timeout while ${message.toLowerCase()}`));
            }, timeout);
        });
    
        return Promise.race([progressPromise, timeoutPromise]);
    }

    private updateProgress(message: string, progress: number): void {
        chrome.storage.local.get(['modelDownloaded'], (result) => {
            const isFirstTime = !result.modelDownloaded;
            if (isFirstTime) {
                chrome.storage.local.set({ modelDownloaded: true });
            }

            if (!this.uiManager.getElements().loadingContainer.hasChildNodes()) {
                this.uiManager.createLoadingUI(isFirstTime);
            }

            this.uiManager.updateProgressBar(progress, isFirstTime);
            this.updateStatus(message, progress < 1);

            if (progress >= 1.0) {
                this.uiManager.handleLoadingComplete(() => {
                    if (this.isFirstLoad) {
                        this.uiManager.enableInputs();
                        this.isFirstLoad = false;
                    }
                });
            }
        });
    }
    private log(message: string) {
        this.debug.textContent += '\n' + message;
        console.log(message);
    }

    private addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .loading {
                color: #666;
                animation: pulse 1.5s infinite;
            }
            @keyframes pulse {
                0% { opacity: 0.6; }
                50% { opacity: 1; }
                100% { opacity: 0.6; }
            }
        `;
        document.head.appendChild(style);
    }

    private updateStatus(message: string, isLoading = true) {
        this.status.textContent = `Status: ${message}`;
        if (isLoading) {
            this.status.classList.add('loading');
        } else {
            this.status.classList.remove('loading');
        }
        this.log(message);
    }

    private async safeInitialize(): Promise<void> {
        const memoryMonitor = setInterval(() => {
            if ((window.performance as Performance)?.memory) {
                const memory = (window.performance as Performance).memory;
                this.logMemoryUsage();
            }
        }, 5000);

        try {
            await this.initializeLLM();
        } catch (error) {
            if (this.initRetryCount < this.MAX_RETRIES) {
                this.initRetryCount++;
                this.log(`Initialization failed, retrying (${this.initRetryCount}/${this.MAX_RETRIES})...`);
                
                if (window.gc) window.gc();
                await new Promise(resolve => setTimeout(resolve, 2000 * this.initRetryCount));
                await this.safeInitialize();
            } else {
                this.updateStatus('Failed to initialize. Please reload the extension.', false);
                throw error;
            }
        } finally {
            clearInterval(memoryMonitor);
        }
    }


    private async handleSubmit(): Promise<void> {
        if (!this.chatManager || this.isFirstLoad || !this.llmInference) return;

        const message = this.uiManager.getMessage();
        if (!message.trim()) return;

        this.uiManager.resetForNewMessage();
        this.updateStatus("Generating response...", true);

        try {
            await this.chatManager.processUserMessage(
                message,
                this.uiManager.updateAnswer.bind(this.uiManager)
            );
            this.updateStatus("Ready", false);
        } catch (error) {
            console.error("Error processing message:", error);
            this.updateStatus("Error generating response", false);
            this.uiManager.updateAnswer("An error occurred while generating the response.");
        }
    }

    private handleInputKeyup(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement;
        input.value ? this.uiManager.enableInputs() : this.uiManager.disableSubmit();
        
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.handleSubmit();
        }
    }

    private initializeEventListeners(): void {
        const elements = this.uiManager.getElements();
        elements.queryInput.addEventListener("keyup", this.handleInputKeyup.bind(this));
        elements.submitButton.addEventListener("click", this.handleSubmit.bind(this));
        elements.copyAnswer.addEventListener("click", () => this.uiManager.copyAnswer());
    }
}

// Initialize popup when window loads
window.onload = () => {
    const popup = new PopupManager();
    popup.initialize().catch(console.error);
};