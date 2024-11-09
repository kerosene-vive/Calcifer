"use strict";

import "./popup.css";
import {
  CreateExtensionServiceWorkerMLCEngine,
  InitProgressReport,
} from "@mlc-ai/web-llm";
import { ChatManager } from './chatManager.ts';

/***************** UI elements *****************/
const queryInput = document.getElementById("query-input")!;
const submitButton = document.getElementById("submit-button")!;
let chatManager: ChatManager;

let isLoadingParams = false;
let isFirstLoad = true;

(<HTMLButtonElement>submitButton).disabled = true;
async function summarizeCurrentPage(tabId: number) {
  if (!isFirstLoad) return; // Summarize only on first load after page change
  console.log("Page change detected. Attempting to summarize...");

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['/mnt/data/contentExtractor.ts']
    });

    if (result && result.result) {
      console.log("Page content extracted successfully:", result.result);

      const summarizationPrompt = `Summarize this page content: ${result.result}`;
      await chatManager.processUserMessage(summarizationPrompt, updateAnswer);

      isFirstLoad = false; // Reset summarization flag to avoid repeats until next page load
    } else {
      console.error("No content extracted from page.");
    }
  } catch (error) {
    console.error("Failed to extract or summarize content:", error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    // New page loaded in the active tab
    summarizeCurrentPage(tabId);
  }
});

// Create loading UI elements
function createLoadingUI(container: HTMLElement, isFirstTime: boolean) {
  container.innerHTML = `
    <div class="loading-progress">
      ${isFirstTime ? `
        <div class="alert">
          <h3>First-time Setup</h3>
          <p>Downloading model files. This may take a few minutes.</p>
        </div>
      ` : `
        <div class="init-message">
          <span>⚙️ Initializing model...</span>
        </div>
      `}
      
      <div class="progress-stats">
        <div class="progress-text">
          <span id="progress-percentage">0%</span>
          <span id="progress-status">${isFirstTime ? 'Downloading...' : 'Loading...'}</span>
        </div>
      </div>
      
      <div class="progress-bar">
        <div id="progress-fill"></div>
      </div>
      
      ${isFirstTime ? `
        <p class="progress-note">This is a one-time download. Future startups will be much faster.</p>
      ` : ''}
    </div>
  `;
}

let lastProgress = 0;
const ANIMATION_DURATION = 500;

const initProgressCallback = (report: InitProgressReport) => {
  chrome.storage.local.get(['modelDownloaded'], function(result) {
    if (result.modelDownloaded) {
      isFirstLoad = false;
    } else {
      chrome.storage.local.set({ modelDownloaded: true });
    }
    
    const progressElement = document.getElementById('loadingContainer');
    if (progressElement) {
      if (!progressElement.hasChildNodes()) {
        createLoadingUI(progressElement, isFirstLoad);
      }
      
      const progressPercent = Math.round(report.progress * 100);
      const progressFill = document.getElementById('progress-fill');
      
      if (progressFill) {
        const start = lastProgress;
        const end = progressPercent;
        const duration = 300;
        const startTime = performance.now();
        
        const animateProgress = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentProgress = start + (end - start) * easeProgress;
          
          progressFill.style.width = `${currentProgress}%`;
          
          const percentageText = document.getElementById('progress-percentage');
          const statusText = document.getElementById('progress-status');
          
          if (percentageText) {
            percentageText.textContent = `${Math.round(currentProgress)}%`;
          }
          
          if (statusText) {
            if (currentProgress === 100) {
              statusText.textContent = 'Complete!';
            } else if (isFirstLoad) {
              statusText.textContent = 'Downloading...';
            } else {
              statusText.textContent = 'Loading...';
            }
          }
          
          if (progress < 1) {
            requestAnimationFrame(animateProgress);
          }
        };
        
        requestAnimationFrame(animateProgress);
        lastProgress = progressPercent;
      }
    }
  });

  if (report.progress >= 1.0) {
    const loadingProgress = document.querySelector('.loading-progress');
    if (loadingProgress) {
      loadingProgress.classList.add('fade-out');
      
      setTimeout(() => {
        const loadingContainer = document.getElementById('loadingContainer');
        if (loadingContainer) {
          loadingContainer.classList.add('removing');
          setTimeout(() => {
            loadingContainer.remove();
          }, ANIMATION_DURATION);
        }
        enableInputs();
      }, ANIMATION_DURATION);
    }
  }
};

function enableInputs() {
  if (isLoadingParams) {
    (<HTMLButtonElement>submitButton).disabled = false;
    queryInput.focus();
    isLoadingParams = false;
  }
}

function updateAnswer(answer: string) {
  document.getElementById("answerWrapper")!.style.display = "block";
  const answerWithBreaks = answer.replace(/\n/g, "<br>");
  document.getElementById("answer")!.innerHTML = answerWithBreaks;
  
  document.getElementById("copyAnswer")!.addEventListener("click", () => {
    navigator.clipboard
      .writeText(answer)
      .then(() => console.log("Answer text copied to clipboard"))
      .catch((err) => console.error("Could not copy text: ", err));
  });

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const time = new Date().toLocaleString("en-US", options);
  document.getElementById("timestamp")!.innerText = time;
  document.getElementById("loading-indicator")!.style.display = "none";
}

/***************** Event Handlers *****************/

async function handleClick() {
  if (isFirstLoad) return;  // Skip initial click if first load is active

  const message = (<HTMLInputElement>queryInput).value;

  document.getElementById("answer")!.innerHTML = "";
  document.getElementById("answerWrapper")!.style.display = "none";
  document.getElementById("loading-indicator")!.style.display = "block";

  await chatManager.processUserMessage(message, updateAnswer);
}

/***************** Initialization *****************/

async function initialize() {
  console.log("Initializing application...");
  
  isFirstLoad = true;  // Reset flag for summarization
  
  const engine = await CreateExtensionServiceWorkerMLCEngine(
    "Qwen2-0.5B-Instruct-q4f16_1-MLC",
    { initProgressCallback: initProgressCallback }
  );
  
  chatManager = new ChatManager(engine);
  await chatManager.initializeWithContext();

  queryInput.addEventListener("keyup", (event) => {
    if ((<HTMLInputElement>queryInput).value === "") {
      (<HTMLButtonElement>submitButton).disabled = true;
    } else {
      (<HTMLButtonElement>submitButton).disabled = false;
    }

    if (event.code === "Enter") {
      event.preventDefault();
      submitButton.click();
    }
  });
  
  submitButton.addEventListener("click", handleClick);
  
  isLoadingParams = true;
  console.log("Initialization complete");

}

// Start initialization when popup opens
window.onload = initialize;