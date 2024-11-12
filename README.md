# WebLLM Chrome Extension using WebGPU Running on Service Worker

![Chrome Extension](https://github.com/mlc-ai/mlc-llm/assets/11940172/0d94cc73-eff1-4128-a6e4-70dc879f04e0)

> [!WARNING]  
> Service worker support in WebGPU is enabled by default in [Chrome 124](https://chromiumdash.appspot.com/commit/8d78510e4aca5ac3cd8ee4a33e96b404eaa43246).
> If you are using Chrome 123, go to `chrome://flags/#enable-experimental-web-platform-features`, enable the `#enable-experimental-web-platform-features` flag, and **relaunch the browser**.

This example shows how we can create a Chrome extension using WebGPU and service worker.

- The project structure is as follows:
  - `manifest.json`: A required file that lists important information about the structure and behavior of that extension. Here we are using manifest V3.
  - `popup.ts`: Script of the extension pop-up window.
  - `background.ts`: Script of the service worker. An extension service worker is loaded when it is needed, and unloaded when it goes dormant.
  - `content.js`: Content script that interacts with DOM.
- Run

  ```bash
  npm install
  npm run build
  ```

  This will create a new directory at `./dist/`. To load the extension into Chrome, go to Extensions > Manage Extensions and select Load Unpacked. Add the `./dist/` directory. You can now pin the extension to your toolbar and use it to chat with your favorite model!

**Note**: This example disables chatting using the contents of the active tab by default.
To enable it, set `useContext` in `popup.ts` to `true`. More info about this feature can be found
[here](https://github.com/mlc-ai/web-llm/pull/190).
However, if the web content is too large, it might run into issues. We recommend using `example.html` to
test this feature.



{
  "manifest_version": 3, // Specifies the version of the manifest file format
  "name": "CalciferNANO", // The name of the extension
  "version": "0.1.0", // The version of the extension
  "description": "Chat with your browser", // A brief description of the extension
  "icons": {
    "16": "icons/icon-16.png", // Icon for the extension at 16x16 pixels
    "32": "icons/icon-32.png", // Icon for the extension at 32x32 pixels
    "64": "icons/icon-64.png", // Icon for the extension at 64x64 pixels
    "128": "icons/icon-128.png" // Icon for the extension at 128x128 pixels
  },
  "content_security_policy": {
    "extension_pages": "style-src-elem 'self' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; script-src 'self' 'wasm-unsafe-eval'; default-src 'self' data:; connect-src 'self' data: http://localhost:8000 https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://raw.githubusercontent.com https://cdn-lfs-us-1.hf.co"
    // Defines the Content Security Policy for the extension pages
    // Allows styles and fonts from self and cdnjs.cloudflare.com
    // Allows scripts from self with 'wasm-unsafe-eval'
    // Allows connections to self, data, localhost, huggingface, and GitHub
  },
  "side_panel": {
    "default_path": "popup.html" // Specifies the default HTML file for the side panel
  },
  "action": {
    "default_title": "CalciferNANO", // The default title for the extension's action
    "default_popup": "popup.html", // The default popup HTML file for the extension's action
    "default_icon": {
      "16": "icons/icon-16.png", // Icon for the action at 16x16 pixels
      "32": "icons/icon-32.png", // Icon for the action at 32x32 pixels
      "64": "icons/icon-64.png", // Icon for the action at 64x64 pixels
      "128": "icons/icon-128.png" // Icon for the action at 128x128 pixels
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"], // Specifies the URLs that the content script will run on
      "js": ["content.js"], // The JavaScript file to be injected into matching pages
      "run_at": "document_end" // Specifies when the content script will be injected
    }
  ],
  "background": {
    "service_worker": "background.ts", // The background service worker script
    "type": "module" // Specifies that the background script is a module
  },
  "permissions": [
    "storage", // Allows the extension to use the storage API
    "tabs", // Allows the extension to interact with browser tabs
    "webNavigation", // Allows the extension to observe and take action in response to navigation events
    "scripting", // Allows the extension to execute scripts in the context of web pages
    "sidePanel", // Allows the extension to use the side panel API
    "activeTab" // Grants temporary permissions to the active tab
  ],
  "host_permissions": [
    "<all_urls>" // Specifies the URLs that the extension can access
  ]
}
