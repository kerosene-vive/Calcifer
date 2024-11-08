import { ChatCompletionMessageParam, MLCEngineInterface } from "@mlc-ai/web-llm";
import { ContentExtractor } from './contentExtractor';

export class ChatManager {
  private engine: MLCEngineInterface;
  private chatHistory: ChatCompletionMessageParam[] = [];

  constructor(engine: MLCEngineInterface) {
    this.engine = engine;
    console.log("ChatManager initialized with engine:", engine);
    this.setupTabListener();
  }

  private setupTabListener() {
    // Listen for tab activations
    chrome.tabs.onActivated.addListener(() => {
      console.log("Tab changed, attempting to fetch new content...");
      this.handleNewPage();
    });

    // Listen for page updates in the current tab
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        console.log("Page loaded, attempting to fetch content...");
        this.handleNewPage();
      }
    });
  }

  private async handleNewPage() {
    console.log("Handling new page content...");

    // Attempt to get page content through the ContentExtractor
    const pageContent = await ContentExtractor.getPageContent();

    if (pageContent) {
      console.log("Page content fetched successfully.");

      // Reset chat history to focus on new page content
      this.chatHistory = [];

      // Add page content as system context for summarization
      this.chatHistory.push({
        role: "system",
        content: `Analyze the following webpage content: ${pageContent.substring(0, 2000)}`
      });

      // Generate summary as an initial response
      await this.generateSummary(pageContent);
    } else {
      console.log("No readable content found on the page.");
    }
  }

  private async generateSummary(content: string) {
    console.log("Generating summary for new page...");

    // Push a user prompt to summarize the content
    this.chatHistory.push({
      role: "user",
      content: "Please provide a concise summary of the webpage content above."
    });

    let summaryMessage = "";  // Accumulate streamed summary here

    try {
      const completion = await this.engine.chat.completions.create({
        stream: true,
        messages: this.chatHistory,
      });

      // Stream the completion and update the summary UI
      for await (const chunk of completion) {
        const curDelta = chunk.choices[0].delta.content;
        if (curDelta) {
          summaryMessage += curDelta;
          this.updateSummaryUI(summaryMessage);
        }
      }

      // Push the final summary message to the chat history
      this.chatHistory.push({ role: "assistant", content: summaryMessage });
      console.log("Summary generated successfully:", summaryMessage);
      
    } catch (error) {
      console.error("Error generating summary:", error);
    }
  }

  private updateSummaryUI(summary: string) {
    let summaryElement = document.getElementById("summary-container");

    if (!summaryElement) {
      // Create summary container if it doesn't exist yet
      summaryElement = document.createElement("div");
      summaryElement.id = "summary-container";
      summaryElement.className = "summary-section";
      document.body.insertBefore(summaryElement, document.getElementById("chat-container"));
    }

    summaryElement.innerHTML = `
      <div class="summary-header">Page Summary</div>
      <div class="summary-content">${summary.replace(/\n/g, '<br>')}</div>
    `;
  }

  async initializeWithContext(): Promise<void> {
    console.log("Initializing chat with context...");
    await this.handleNewPage();
  }

  async processUserMessage(message: string, updateCallback: (text: string) => void): Promise<void> {
    console.log("Processing user message:", message);

    // Add user message to chat history
    this.chatHistory.push({ role: "user", content: message });

    let curMessage = "";  // Accumulate streamed message here

    try {
      const completion = await this.engine.chat.completions.create({
        stream: true,
        messages: this.chatHistory,
      });

      // Stream the response to the UI
      for await (const chunk of completion) {
        const curDelta = chunk.choices[0].delta.content;
        if (curDelta) {
          curMessage += curDelta;
          updateCallback(curMessage);
        }
      }

      // Add final message to chat history for continuity
      this.chatHistory.push({ role: "assistant", content: curMessage });

    } catch (error) {
      console.error("Error during chat processing:", error);
      throw error;
    }
  }
}
