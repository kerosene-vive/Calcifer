// mlcEngineService.ts

import { 
    CreateExtensionServiceWorkerMLCEngine, 
    ExtensionServiceWorkerMLCEngineHandler,
    MLCEngineInterface,
    InitProgressReport,
    ChatCompletionMessageParam
} from "@mlc-ai/web-llm";

export type { MLCEngineInterface };  // Re-export the original interface

// Other interfaces
export interface IProgressReport {
    progress: number;
    detail: string;
}

export interface IChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ICompletionChunk {
    choices: Array<{
        delta: {
            content?: string;
        };
    }>;
}

export type ProgressCallback = (report: IProgressReport) => void;

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
            this.engine = await CreateExtensionServiceWorkerMLCEngine(
                "Qwen2-0.5B-Instruct-q4f16_1-MLC",
                { 
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