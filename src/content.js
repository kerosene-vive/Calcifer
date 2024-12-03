// content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROCESS_INFERENCE') {
        handleInference(message.prompt, message.requestId, sendResponse);
        return true;
    }
});

async function handleInference(prompt, requestId, sendResponse) {
    try {
        let response = '';
        await window.llmManager.streamResponse(prompt, (partial) => {
            response = partial;
        });

        sendResponse({ 
            type: 'INFERENCE_RESULT', 
            requestId,
            data: response 
        });
    } catch (error) {
        sendResponse({ 
            type: 'INFERENCE_ERROR', 
            requestId,
            error: String(error) 
        });
    }
}

chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_LOADED' });