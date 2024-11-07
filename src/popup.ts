"use strict";

// This code is partially adapted from the openai-chatgpt-chrome-extension repo:
// https://github.com/jessedi0n/openai-chatgpt-chrome-extension

import "./popup.css";
import {
  ChatCompletionMessageParam,
  CreateExtensionServiceWorkerMLCEngine,
  MLCEngineInterface,
  InitProgressReport,
} from "@mlc-ai/web-llm";

/***************** UI elements *****************/
// Whether or not to use the content from the active tab as the context
const useContext = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const queryInput = document.getElementById("query-input")!;
const submitButton = document.getElementById("submit-button")!;

let isLoadingParams = false;
let isFirstLoad = true;

(<HTMLButtonElement>submitButton).disabled = true;

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

/***************** Web-LLM MLCEngine Configuration *****************/
let lastProgress = 0;
const ANIMATION_DURATION = 500; // ms

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
      
      // Smoothly interpolate progress
      const progress = report.progress;
      const progressPercent = Math.round(progress * 100);
      
      // Animate from last progress to new progress
      const progressFill = document.getElementById('progress-fill');
      if (progressFill) {
        const start = lastProgress;
        const end = progressPercent;
        const duration = 300; // ms
        const startTime = performance.now();
        
        const animateProgress = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          
          // Use easeOutCubic easing function for smooth progression
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentProgress = start + (end - start) * easeProgress;
          
          progressFill.style.width = `${currentProgress}%`;
          
          // Update text displays
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

const engine: MLCEngineInterface = await CreateExtensionServiceWorkerMLCEngine(
  "Qwen2-0.5B-Instruct-q4f16_1-MLC",
  { initProgressCallback: initProgressCallback },
);
const chatHistory: ChatCompletionMessageParam[] = [];

isLoadingParams = true;



/***************** Event Listeners *****************/

// Disable submit button if input field is empty
queryInput.addEventListener("keyup", () => {
  if ((<HTMLInputElement>queryInput).value === "") {
    (<HTMLButtonElement>submitButton).disabled = true;
  } else {
    (<HTMLButtonElement>submitButton).disabled = false;
  }
});

// If user presses enter, click submit button
queryInput.addEventListener("keyup", (event) => {
  if (event.code === "Enter") {
    event.preventDefault();
    submitButton.click();
  }
});

// Listen for clicks on submit button
async function handleClick() {
  // Get the message from the input field
  const message = (<HTMLInputElement>queryInput).value;
  console.log("message", message);
  chatHistory.push({ role: "user", content: message });

  // Clear the answer
  document.getElementById("answer")!.innerHTML = "";
  // Hide the answer
  document.getElementById("answerWrapper")!.style.display = "none";
  // Show the loading indicator
  document.getElementById("loading-indicator")!.style.display = "block";

  // Send the chat completion message to the engine
  let curMessage = "";
  const completion = await engine.chat.completions.create({
    stream: true,
    messages: chatHistory,
  });

  // Update the answer as the model generates more text
  for await (const chunk of completion) {
    const curDelta = chunk.choices[0].delta.content;
    if (curDelta) {
      curMessage += curDelta;
    }
    updateAnswer(curMessage);
  }
  chatHistory.push({ role: "assistant", content: await engine.getMessage() });
}

submitButton.addEventListener("click", handleClick);

function updateAnswer(answer: string) {
  // Show answer
  document.getElementById("answerWrapper")!.style.display = "block";
  const answerWithBreaks = answer.replace(/\n/g, "<br>");
  document.getElementById("answer")!.innerHTML = answerWithBreaks;
  // Add event listener to copy button
  document.getElementById("copyAnswer")!.addEventListener("click", () => {
    // Get the answer text
    const answerText = answer;
    // Copy the answer text to the clipboard
    navigator.clipboard
      .writeText(answerText)
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
  // Update timestamp
  document.getElementById("timestamp")!.innerText = time;
  // Hide loading indicator
  document.getElementById("loading-indicator")!.style.display = "none";
}

function fetchPageContents() {
  chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
    if (tabs[0]?.id) {
      const port = chrome.tabs.connect(tabs[0].id, { name: "channelName" });
      port.postMessage({});
      port.onMessage.addListener(function (msg) {
        console.log("Page contents:", msg.contents);
        chrome.runtime.sendMessage({ context: msg.contents });
      });
    }
  });
}

// Grab the page contents when the popup is opened
window.onload = function () {
  if (useContext) {
    fetchPageContents();
  }
};