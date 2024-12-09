// Type definitions for MediaPipe GenAI Tasks
/// <reference types="@webgpu/types" />

declare module '*genai_bundle.mjs' {
  export interface WebGpuOptions {
      /**
       * The WebGPU device to perform the LLM Inference task.
       */
      device?: GPUDevice;
      /**
       * The information of WebGPU adapter for performance optimization
       */
      adapterInfo?: GPUAdapterInfo;
  }

  export interface BaseOptions {
      /**
       * The model path to the model asset file.
       * Only one of `modelAssetPath` or `modelAssetBuffer` can be set.
       */
      modelAssetPath?: string;
      /**
       * A buffer containing the model asset.
       * Only one of `modelAssetPath` or `modelAssetBuffer` can be set.
       */
      modelAssetBuffer?: Uint8Array | ReadableStreamDefaultReader;
      /** Overrides the default backend to use for the provided model. */
      delegate?: "CPU" | "GPU";
      /** WebGPU specific options */
      gpuOptions?: WebGpuOptions;
  }

  export interface LlmInferenceOptions {
      /** Options to configure the model loading and processing. */
      baseOptions?: BaseOptions;
      /** Maximum number of the combined input and output tokens. */
      maxTokens?: number;
      /** Number of candidate tokens to sample from the softmax output in top-k sampling. */
      topK?: number;
      /** Temperature used to scale the logits before computing softmax. */
      temperature?: number;
      /** Random seed for sampling tokens. */
      randomSeed?: number;
      /** The LoRA ranks that will be used during inference. */
      loraRanks?: number[];
      /** Number of responses to generate for 'generateResponses' calls. */
      numResponses?: number;
  }

  export interface WasmFileset {
      /** The path to the Wasm loader script. */
      wasmLoaderPath: string;
      /** The path to the Wasm binary. */
      wasmBinaryPath: string;
      /** The optional path to the asset loader script. */
      assetLoaderPath?: string;
      /** The optional path to the assets binary. */
      assetBinaryPath?: string;
  }

  export class LoraModel {
      readonly owner: LlmInference;
      readonly loraModelId: number;
  }

  export type ProgressListener = (partialResult: string, done: boolean) => unknown;
  export type MultiResponseProgressListener = (partialResults: string[], done: boolean) => unknown;

  export class LlmInference {
      /**
       * Creates a new LlmInference instance with the specified options.
       */
      static createFromOptions(wasmFileset: WasmFileset, options: LlmInferenceOptions): Promise<LlmInference>;
      
      /**
       * Creates a new LlmInference instance from a model buffer.
       */
      static createFromModelBuffer(wasmFileset: WasmFileset, modelBuffer: Uint8Array | ReadableStreamDefaultReader): Promise<LlmInference>;
      
      /**
       * Creates a new LlmInference instance from a model path.
       */
      static createFromModelPath(wasmFileset: WasmFileset, modelPath: string): Promise<LlmInference>;

      /**
       * Create WebGPU device with high performance configurations.
       */
      static createWebGpuDevice(): Promise<GPUDevice>;

      /**
       * Updates the options for this LlmInference instance.
       */
      setOptions(options: LlmInferenceOptions): Promise<void>;

      /**
       * Generates a text response for the given prompt.
       */
      generateResponse(prompt: string): Promise<string>;
      generateResponse(prompt: string, progressListener: ProgressListener): Promise<string>;
      generateResponse(prompt: string, loraModel: LoraModel): Promise<string>;
      generateResponse(prompt: string, loraModel: LoraModel, progressListener: ProgressListener): Promise<string>;

      /**
       * Generates multiple text responses for the given prompt.
       */
      generateResponses(prompt: string): Promise<string[]>;
      generateResponses(prompt: string, progressListener: MultiResponseProgressListener): Promise<string[]>;
      generateResponses(prompt: string, loraModel: LoraModel): Promise<string[]>;
      generateResponses(prompt: string, loraModel: LoraModel, progressListener: MultiResponseProgressListener): Promise<string[]>;

      /**
       * Returns the number of tokens in the text.
       */
      sizeInTokens(text: string): number | undefined;

      /**
       * Loads a LoRA model for use with this LlmInference instance.
       */
      loadLoraModel(modelAsset: string | Uint8Array): Promise<LoraModel>;

      /**
       * Closes and cleans up resources.
       */
      close(): void;
  }

  export class FilesetResolver {
      /**
       * Returns whether SIMD is supported in the current environment.
       */
      static isSimdSupported(): Promise<boolean>;

      /**
       * Creates a fileset for the MediaPipe Audio tasks.
       */
      static forAudioTasks(basePath?: string): Promise<WasmFileset>;

      /**
       * Creates a fileset for the MediaPipe GenAI tasks.
       */
      static forGenAiTasks(basePath?: string): Promise<WasmFileset>;

      /**
       * Creates a fileset for the MediaPipe Text tasks.
       */
      static forTextTasks(basePath?: string): Promise<WasmFileset>;

      /**
       * Creates a fileset for the MediaPipe Vision tasks.
       */
      static forVisionTasks(basePath?: string): Promise<WasmFileset>;
  }
}

interface Navigator {
  gpu: {
      requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
  };
}