# Calcifer Nano

Calcifer is a Chrome extension that dynamically extracts links from the page you are viewing and uses AI to rank them, helping you quickly find what you're looking for without excessive scrolling or searching. **This is a beta version** and is open to improvements.

---

## Features

- **Dynamic Link Extraction**: Identifies and ranks links in real-time.

---

## Setup

### Prerequisites
- Google Chrome **Version 131.0.6778.33** (beta) or later.
- WebGPU-enabled browser.

### Installation Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/kerosene-vive/Calcifer
   cd Calcifer
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load the extension in Chrome:
   
   - Navigate to `chrome://extensions`.
   - Enable **Developer Mode**.
   - Click **Load unpacked** and select the `dist` folder.

> **Note:** The first-time setup will download model weights from Hugging Face.

---

## Developer Notes

### Technical Details
- **Inference Engine**: Powered by **Gemini Nano**, utilizing AI for link ranking.
- **Model Weights**:

  - Fetched from Hugging Face and cached locally.
  - Split into smaller chunks hosted in a dedicated Hugging Face repository due to size constraints.
    
- **Inference Processing**: Handled using **Mediapipe**.
- **Technology Stack**: Built with TypeScript, WebGPU, and Mediapipe.

### Current Limitations
- **Beta Status**: Improvements are needed, including:
  
  - Using a service worker for inference.
  - Enhancing link ranking accuracy.
  - Supporting more web pages.
  - Reducing initialization and inference times.

### Contributions
Feel free to open a pull request to help improve Calcifer

---

## Links

- [Hugging Face Weight Repository](https://huggingface.co/lagunablublu/test_shards)

---

