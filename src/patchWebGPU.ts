// patchWebGPU.ts
export function patchWebGPU(): void {
    if (!navigator.gpu) return;

    const originalRequestAdapter = navigator.gpu.requestAdapter;
    navigator.gpu.requestAdapter = async function (...args): Promise<any | null> {
        const adapter = await originalRequestAdapter.apply(this, args);
        if (!adapter) return null;

        // Patch adapter to include custom requestAdapterInfo method
        adapter.requestAdapterInfo = function (): Promise<{ vendor: string; architecture: string }> {
            return Promise.resolve(this.info || { vendor: "unknown", architecture: "unknown" });
        };

        const originalRequestDevice = adapter.requestDevice;
        adapter.requestDevice = async function (...deviceArgs): Promise<any | null> {
            const device = await originalRequestDevice.apply(this, deviceArgs);
            if (!device) return null;

            // Define custom adapterInfo on the device
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
