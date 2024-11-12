// background.ts
import { mlcEngineService } from "./mlcEngineService";

// Set the behavior of the side panel to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Listen for connections to the runtime
chrome.runtime.onConnect.addListener((port) => {
  mlcEngineService.handlePortConnection(port);
});
