export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class MessageService {
    private messageCallback: (content: string, role: 'user' | 'assistant', isUpdating?: boolean) => void;

    constructor(messageCallback: (content: string, role: 'user' | 'assistant', isUpdating?: boolean) => void) {
        this.messageCallback = messageCallback;
    }

    public addUserMessage(content: string): void {
        this.messageCallback(content, 'user');
    }

    public updateAssistantMessage(content: string, isUpdating = true): void {
        this.messageCallback(content, 'assistant', isUpdating);
    }

    public showError(error: string): void {
        this.messageCallback(`Error: ${error}`, 'assistant');
    }
}