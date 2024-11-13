export function addMessageToUI(content: string, role: 'user' | 'assistant', isUpdating: boolean = false): void {
    try {
        const chatHistoryContainer = document.querySelector('.chat-history');
        if (!chatHistoryContainer) {
            throw new Error("Chat history container not found");
        }

        let messageElement: HTMLElement;
        
        if (isUpdating) {
            messageElement = chatHistoryContainer.querySelector('.message-wrapper:last-child') as HTMLElement;
            if (!messageElement) {
                messageElement = createMessageElement(content, role);
                chatHistoryContainer.appendChild(messageElement);
            } else {
                const messageContent = messageElement.querySelector('.message-content');
                if (messageContent) {
                    messageContent.innerHTML = sanitizeHTML(content);
                }
            }
        } else {
            messageElement = createMessageElement(content, role);
            chatHistoryContainer.appendChild(messageElement);
        }

        const answerWrapper = document.getElementById('answerWrapper');
        if (answerWrapper) {
            answerWrapper.style.display = 'block';
        }
    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

export function createMessageElement(content: string, role: 'user' | 'assistant'): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    
    wrapper.innerHTML = `
        <div class="message ${role}-message">
            <div class="message-header">
                ${role === 'assistant' ? '<img src="/icons/icon-128.png" alt="Bot Icon" class="message-icon" onerror="this.style.display=\'none\'">' : ''}
                <span class="timestamp">${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="message-content">${sanitizeHTML(content)}</div>
        </div>
    `;
    
    return wrapper;
}

export function sanitizeHTML(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>');
}
