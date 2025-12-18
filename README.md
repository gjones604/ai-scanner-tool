# Image AI Hover 🖼️ (Browser Extension + React Gallery)

A browser extension and React web application that uses Ultralytics YOLO for real-time object detection. The extension shows AI detection results in a floating popup that follows your cursor when you hold a configurable keyboard key or mouse button and hover over images on any website.

## Features ✨

### Browser Extension

- **Configurable Activation**: Customizable activation key (Shift, Ctrl, Alt)
- **Floating Popup**: Detection results appear in a popup that follows your mouse cursor
- **Performance Optimized**: Caching system for faster repeated detections
- **Visual Results**: Color-coded detection results with confidence scores and object types
- **Local Summaries**: Highlighted text can be summarized via LM Studio or Ollama running on your machine. The extension prioritizes summarization over image scans when both highlighted text and hovered images are available.
- **Interactive Analysis**: Analyze images while hovering
- **Real-time Status**: Live server connection monitoring

## Prerequisites 📋

1. **Python 3.8+**: Install Python from [python.org](https://python.org)
2. **Browser Extension**: Chrome or compatible browser
3. **Ultralytics YOLO**: Install required packages:
   ```bash
   pip install -r requirements.txt
   ```

### Local Summarization Endpoints

- LM Studio: `POST http://127.0.0.1:1234/v1/chat/completions` (OpenAI-compatible schema)
- Ollama: `POST http://127.0.0.1:11434/v1/chat/completions` (enable Ollama compatibility mode). When "Ollama" is selected as the provider, the extension automatically adds the `options` block expected by Ollama.

> **Tip:** LM Studio exposes the models listed in its UI (e.g., `qwen/qwen3-4b-2507`, `google/gemma-3-12b`). Copy the model ID directly into the popup settings. The extension caches summaries so repeated highlights feel instant.

## Quick Start 🚀

1. **Start the YOLO Server**:

   ```bash
   py -3.12 server.py
   ```

   Server will run on `http://localhost:8001`

2. **Load the Extension**:

   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked" and select the `extension/` folder
   - The extension is now active!

3. **Configure the Extension**:

   - Click the extension icon in the toolbar
   - Choose your preferred activation method (keyboard key or mouse button)
   - Set the YOLO detection API URL if different from default
   - (Optional) Enable "Text Summarization" and point it to your local LM Studio or Ollama endpoint (defaults to `http://127.0.0.1:1234/v1/chat/completions`).
   - Pick a model ID exposed by LM Studio/Ollama (for example `qwen/qwen3-4b-2507`).
   - Test the connection to ensure the server is running

4. **Use the Extension**:

   - Visit any website with images
   - Hold your chosen **input** (key or mouse button) and hover over images
   - If you highlight text before holding the trigger key, the extension shows a local AI summary instead of an image scan
   - See detection results (or summaries) in a floating popup that follows your cursor
   - Release the input to hide the popup

5. **View Saved Images** (Optional):
   ```bash
   # Start React gallery (optional)
   cd src
   npm install
   npm start
   ```
   Visit `http://localhost:3000` to view saved images

## How the Extension Works 🔧

1. **Input Detection**: When you hold the configured trigger input (keyboard key or mouse button), detection mode activates
2. **Image Hover**: Moving your mouse over images triggers the analysis
3. **AI Processing**: YOLO11 model detects objects and returns bounding boxes with confidence scores
4. **Floating Display**: Detection results appear in a popup that follows your mouse cursor
5. **Real-time Updates**: Results update as you move between different images

## Extension Configuration ⚙️

The extension can be configured via the popup interface:

- **Activation Method**: Choose between keyboard keys or mouse buttons
  - Keyboard options: Shift, Control (Ctrl), Alt
  - Mouse options: Left Click (0), Middle Click (1), Right Click (2)
- **API Endpoints**: Configurable server endpoints
- **Performance**: Built-in caching and optimization

## API Endpoints 📡

The server provides these endpoints:

```javascript
// Detect objects in image
POST /api/detect-base64
{
  "image": "base64-encoded-image-data"
}

// Get server status
GET /api/status

// List saved images
GET /api/images

// Serve image files
GET /images/{filename}
```

## Troubleshooting 🐛

### Extension Issues

1. **"Extension not loading"**

   - Make sure you're loading from the `extension/` folder
   - Check that all files are present: `manifest.json`, `content.js`, etc.

2. **"Detection not working"**

   - Make sure your trigger input is held down while hovering
   - Check that images are accessible (not blocked by CORS)
   - Verify API endpoints are responding
   - Check browser console for errors

3. **"Popup not appearing"**
   - Ensure the trigger input is configured correctly
   - Check that the YOLO server is running and accessible
   - Verify the API URL in settings matches your server

### Performance Tips

- **Caching**: The extension caches detection results for faster repeated analysis
- **Memory Management**: Caches are cleared when the input is released
- **Image Optimization**: Images are compressed before sending to API
- **Fallback Support**: Multiple image loading strategies for compatibility

## Development 🛠️

### Extension Files

```
extension/
├── manifest.json      # Extension configuration
├── content.js         # Main extension logic (detection + popup overlay)
├── background.js      # Background service worker
├── popup.html         # Settings interface
├── popup.js          # Popup functionality
└── overlay.css       # Styling for detection overlays
```

### Adding New Features

The extension is built with modern JavaScript classes and includes:

- **Image Processing**: Robust image detection that works with with multiple formats but not background images.
- **API Communication**: Robust error handling and retry logic
- **Caching System**: In-memory caches for performance
- **UI Components**: Dynamic popup generation with styled results

## Future Enhancements 🚀

- **Custom Models**: Support for different YOLO variants
- **Export Options**: Download detection results or annotated images
- **Advanced Settings**: Confidence thresholds and detection filters
- **Image Management**: Save, organize, and manage analyzed images to avoid repeated downloads

---

**_Long Term Vision_**
- A simple to use browser extension that provides user with insights and quick access to common actions depending on the content they are viewing in real-time. A sort of "cyberpunk 2077" scanner from the video game but for the web.
- Eventually there could be a monitzation path where ads are served along side the extension display.

**_Style_**
Should have a "crawling animation" effect where lines from detections are drawn tracking to the mouse cursor as it moves around. Creating a sort of visual web that follows the cursor around while the detection results are displayed. The lines should be animated to give a crawling effect as hover moves from image to image.