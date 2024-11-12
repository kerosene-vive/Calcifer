import { ExtensionServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Declare a variable to hold the service worker handler
let handler;

// Set the behavior of the side panel to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error)); // Log any errors to the console

// Listen for connections to the runtime
chrome.runtime.onConnect.addListener(function (port) {
  // Ensure the port name is "web_llm_service_worker"
  console.assert(port.name === "web_llm_service_worker");

  // If the handler is not already initialized, create a new instance
  if (handler === undefined) {
    handler = new ExtensionServiceWorkerMLCEngineHandler(port);
  } else {
    // If the handler is already initialized, set the new port
    handler.setPort(port);
  }

  // Add a listener for messages on the port and bind it to the handler's onmessage method
  port.onMessage.addListener(handler.onmessage.bind(handler));
});
