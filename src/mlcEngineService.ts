import {
    CreateExtensionServiceWorkerMLCEngine,
    ExtensionServiceWorkerMLCEngineHandler,
    MLCEngineInterface,
    InitProgressReport,
    ChatCompletionMessageParam
  } from "@mlc-ai/web-llm";
  
  export type { MLCEngineInterface, ChatCompletionMessageParam };
  
  // Interfaces
  export interface ProgressReport {
    progress: number;
    detail: string;
  }
  
  export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }
  
  export interface CompletionChunk {
    choices: Array<{
      delta: {
        content?: string;
      };
    }>;
  }
  
  export type ProgressCallback = (report: ProgressReport) => void;
  
  export class MLCEngineService {
    private static instance: MLCEngineService;
    private engine: MLCEngineInterface | null = null;
    private handler: ExtensionServiceWorkerMLCEngineHandler | undefined;
  
    private constructor() {}
  
    public static getInstance(): MLCEngineService {
      if (!MLCEngineService.instance) {
        MLCEngineService.instance = new MLCEngineService();
      }
      return MLCEngineService.instance;
    }
  
    public async initializeEngine(progressCallback?: ProgressCallback): Promise<MLCEngineInterface> {
      if (!this.engine) {
        const modelLibURLPrefix = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/";
        const modelVersion = "v0_2_48";
  
        const selectedModelId = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
  
        const appConfig = {
          model_list: [
            {
              model: "https://huggingface.co/mlc-ai/Qwen2-0.5B-Instruct-q4f16_1-MLC",
              model_id: selectedModelId,
              model_lib: modelLibURLPrefix + modelVersion + "/Qwen2-0.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm"
            }
          ]
        };
  
        this.engine = await CreateExtensionServiceWorkerMLCEngine(
          selectedModelId,
          {
            appConfig,
            initProgressCallback: (report: InitProgressReport) => {
              progressCallback?.({
                progress: report.progress,
                detail: ''
              });
            }
          }
        );
      }
      return this.engine;
    }
  
    public handlePortConnection(port: chrome.runtime.Port): void {
      console.assert(port.name === "web_llm_service_worker");
      if (this.handler === undefined) {
        this.handler = new ExtensionServiceWorkerMLCEngineHandler(port);
      } else {
        this.handler.setPort(port);
      }
      port.onMessage.addListener(this.handler.onmessage.bind(this.handler));
    }
  
    public getEngine(): MLCEngineInterface | null {
      return this.engine;
    }
  }
  
  export const mlcEngineService = MLCEngineService.getInstance();