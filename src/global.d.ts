declare module '*genai_bundle.mjs' {
    export class LlmInference {
      constructor(options: any);
      setOptions(options: any): Promise<void>;
      generateResponse(prompt: string, callback?: (response: string, isComplete: boolean) => void): Promise<string>;
      generateResponses(prompt: string, callback?: (responses: string[], isComplete: boolean) => void): Promise<string[]>;
      sizeInTokens(text: string): number;
      loadLoraModel(model: Uint8Array | string): Promise<any>;
      close(): void;
    }
  
    export class FilesetResolver {
      static forGenAiTasks(path: string): Promise<any>;
    }
  }
  
  interface Navigator {
    gpu: {
        requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    };
  }