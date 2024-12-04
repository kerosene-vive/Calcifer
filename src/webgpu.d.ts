interface GPURequestAdapterOptions {
    powerPreference?: 'low-power' | 'high-performance';
    forceFallbackAdapter?: boolean;
}

interface Navigator {
    gpu: {
        requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    };
}

interface GPUAdapter {
    requestAdapterInfo(): Promise<GPUAdapterInfo>;
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice | null>;
}

interface GPUAdapterInfo {
    vendor: string;
    architecture: string;
}

interface GPUDevice {
    adapterInfo: GPUAdapterInfo;
}

interface GPUDeviceDescriptor {
    requiredFeatures?: GPUFeatureName[];
    requiredLimits?: Record<string, number>;
}

type GPUFeatureName = 'texture-compression-bc' | 'timestamp-query' | 'pipeline-statistics-query';