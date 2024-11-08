import { isProbablyReaderable, Readability } from '@mozilla/readability';

export class ContentExtractor {
  static extractContent(): string | false {
    console.log("Starting content extraction");

    // Check if document is readable
    const isParseable = isProbablyReaderable(document, {
      minContentLength: 100,
    });
    console.log("Is document parseable:", isParseable);

    if (!isParseable) {
      return false;
    }

    const documentClone = document.cloneNode(true) as Document;
    const article = new Readability(documentClone).parse();
    console.log("Extracted article:", article);

    if (article) {
      console.log("Content length:", article.textContent.length);
      console.log("First 100 chars:", article.textContent.substring(0, 100));
    }

    return article?.textContent || false;
  }

  static async getPageContent(): Promise<string | null> {
    console.log("Getting page content...");

    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        console.log("Active tab:", tabs[0]);

        if (tabs[0]?.id) {
          console.log("Injecting content script into tab:", tabs[0].id);

          chrome.scripting.executeScript(
            {
              target: { tabId: tabs[0].id },
              func: ContentExtractor.extractContent,
            },
            (results) => {
              console.log("Script execution results:", results);

              if (results && results[0]?.result) {
                console.log("Successfully extracted content");
                resolve(results[0].result);
              } else {
                console.log("No content extracted or error occurred");
                resolve(null);
              }
            }
          );
        } else {
          console.log("No active tab found");
          resolve(null);
        }
      });
    });
  }
}
