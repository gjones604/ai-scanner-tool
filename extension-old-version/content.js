class ImageAIHover {
  constructor() {
    this.isActive = false;
    this.currentOverlay = null;
    this.hoveredImage = null;
    this.mousePosition = { x: 0, y: 0 };
    this.isUpdatingOverlay = false; // Flag to prevent concurrent overlay updates
    this.currentImageSrc = "";
    this.overlayBoxEl = null;
    this.lastOverlaySrc = "";
    this._positionRaf = 0;
    this.lastImageHoverTime = 0; // Track when we last hovered over an image
    this.showIndicatorMode = false; // Track if we're in indicator-only mode
    this.hoverMenu = null; // New hover menu instance
    this.settings = {
      triggerInput: "keyboard:Shift", // Format: "keyboard:KeyName" or "mouse:button"
      detectionEndpoint: "http://localhost:8001/api/detect-base64",
      showCrawlingLines: true,
      enableSummarization: true,
      summarizationProvider: "lmstudio",
      // Default LM Studio text endpoint: use chat completions; we still treat it as one-shot.
      summarizationEndpoint: "http://127.0.0.1:1234/v1/chat/completions",
      summarizationModel: "nvidia/nemotron-3-nano", //"qwen/qwen3-4b-2507",
      minSummaryChars: 40,
      toggleActivation: false,
    };

    this.summaryCache = new Map();
    this.summaryCacheMaxSize = 30;
    this.currentSelectionText = ""; // truncated text used for API calls
    this.currentSelectionRawText = ""; // full highlighted text
    this.currentSelectionPreview = ""; // short preview for UI
    this.currentSelectionKey = "";
    this.currentSelectionRect = null;
    this.summaryModeActive = false;
    this.currentSummaryResult = null;
    this.summaryErrorMessage = "";
    this.isSummarizingText = false;
    this.summaryRequestSeq = 0;
    this.activeSummaryKey = "";
    this.summaryInFlightKey = "";
    this.maxSummaryInputChars = 5000;
    this.selectionChangeTimeout = 0;

    // Initialize ImageScanner instance
    this.imageScanner = new ImageScanner(this);

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.createOverlay();
    this.initializeHoverMenu();
    this.imageScanner.ensureCrawlingCanvas();
    window.addEventListener("resize", () => {
      if (!this.imageScanner.crawlingCanvas) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (
        w !== this.imageScanner.viewportW ||
        h !== this.imageScanner.viewportH
      ) {
        this.imageScanner.viewportW = w;
        this.imageScanner.viewportH = h;
        this.imageScanner.crawlingCanvas.width = w;
        this.imageScanner.crawlingCanvas.height = h;
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === "SCAN_FULL_PAGE_TEXT") {
        this.scanFullPageText();
        sendResponse({ success: true });
      }
      return true;
    });
  }

  activateScanner() {
    if (this.isActive) {
      return;
    }
    this.isActive = true;
    this.showOverlay(null);
    if (this.settings.enableSummarization) {
      this.processTextSummaryFlow(true);
    }
  }

  deactivateScanner() {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    this.exitSummaryMode();

    if (
      this.hoverMenu &&
      typeof this.hoverMenu.getIsActive === "function" &&
      typeof this.hoverMenu.hideMenu === "function" &&
      this.hoverMenu.getIsActive()
    ) {
      this.hoverMenu.hideMenu();
    }

    this.hideOverlay();
    this.hoveredImage = null;
    this.currentImageSrc = "";
    this.showIndicatorMode = false;
    this.lastImageHoverTime = 0;
  }

  createOverlay() {
    // Create the main overlay container
    this.currentOverlay = document.createElement("div");
    this.currentOverlay.id = "image-ai-hover-overlay";
    this.currentOverlay.style.position = "fixed";
    this.currentOverlay.style.display = "none";
    this.currentOverlay.style.zIndex = "999999";
    this.currentOverlay.style.pointerEvents = "none";
    this.currentOverlay.style.background = "transparent";
    this.currentOverlay.style.userSelect = "none";
    this.currentOverlay.style.webkitUserSelect = "none";
    this.currentOverlay.style.MozUserSelect = "none";
    this.currentOverlay.style.msUserSelect = "none";

    // Add to document body
    document.body.appendChild(this.currentOverlay);
  }

  initializeHoverMenu() {
    // Initialize the hover menu from hovering.js (loaded via manifest)
    if (window.ImageHoverMenu) {
      this.hoverMenu = new window.ImageHoverMenu();
      console.log("Hover menu initialized successfully");
    } else {
      console.warn(
        "ImageHoverMenu class not found. Make sure hovering.js is loaded."
      );
      // Retry after a short delay
      setTimeout(() => {
        if (window.ImageHoverMenu && !this.hoverMenu) {
          this.hoverMenu = new window.ImageHoverMenu();
          console.log("Hover menu initialized on retry");
        }
      }, 100);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        "triggerInput",
        "detectionEndpoint",
        "showCrawlingLines",
        "enableSummarization",
        "summarizationProvider",
        "summarizationEndpoint",
        "summarizationModel",
        "minSummaryChars",
        "toggleActivation",
      ]);
      if (result.triggerInput) this.settings.triggerInput = result.triggerInput;
      if (result.detectionEndpoint)
        this.settings.detectionEndpoint = result.detectionEndpoint;
      if (typeof result.showCrawlingLines === "boolean")
        this.settings.showCrawlingLines = result.showCrawlingLines;
      if (typeof result.enableSummarization === "boolean")
        this.settings.enableSummarization = result.enableSummarization;
      if (result.summarizationProvider)
        this.settings.summarizationProvider = result.summarizationProvider;
      if (result.summarizationEndpoint)
        this.settings.summarizationEndpoint = result.summarizationEndpoint;
      if (result.summarizationModel)
        this.settings.summarizationModel = result.summarizationModel;
      if (
        typeof result.minSummaryChars === "number" &&
        !Number.isNaN(result.minSummaryChars)
      ) {
        this.settings.minSummaryChars = Math.max(1, result.minSummaryChars);
      }
      if (typeof result.toggleActivation === "boolean") {
        this.settings.toggleActivation = result.toggleActivation;
      }
    } catch (error) {
      // Using default settings
    }
  }

  setupEventListeners() {
    // Parse trigger input type and value
    const [inputType, inputValue] = this.settings.triggerInput.split(":");

    if (inputType === "keyboard") {
      // Keyboard events
      document.addEventListener("keydown", this.handleKeyDown.bind(this));
      if (!this.settings.toggleActivation) {
        document.addEventListener("keyup", this.handleKeyUp.bind(this));
      }
    } else if (inputType === "mouse") {
      // Mouse events
      document.addEventListener("mousedown", this.handleMouseDown.bind(this));
      if (!this.settings.toggleActivation) {
        document.addEventListener("mouseup", this.handleMouseUp.bind(this));
      }
    } else {
      // Fallback to keyboard Shift
      document.addEventListener("keydown", this.handleKeyDown.bind(this));
      if (!this.settings.toggleActivation) {
        document.addEventListener("keyup", this.handleKeyUp.bind(this));
      }
    }

    // Mouse movement tracking
    document.addEventListener("mousemove", this.handleMouseMove.bind(this));

    // Track highlighted text changes for summarization
    document.addEventListener(
      "selectionchange",
      this.handleSelectionChange.bind(this)
    );
  }

  handleKeyDown(event) {
    const [inputType, inputValue] = this.settings.triggerInput.split(":");

    if (
      inputType === "keyboard" &&
      (event.key === inputValue || event.code === inputValue)
    ) {
      if (this.settings.toggleActivation) {
        if (this.isActive) {
          this.deactivateScanner();
        } else {
          this.activateScanner();
        }
      } else {
        this.activateScanner();
      }

      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleKeyUp(event) {
    if (this.settings.toggleActivation) {
      return;
    }
    const [inputType, inputValue] = this.settings.triggerInput.split(":");

    if (
      inputType === "keyboard" &&
      (event.key === inputValue || event.code === inputValue)
    ) {
      this.deactivateScanner();

      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleMouseDown(event) {
    const [inputType, inputValue] = this.settings.triggerInput.split(":");

    if (inputType === "mouse" && event.button === parseInt(inputValue, 10)) {
      if (this.settings.toggleActivation) {
        if (this.isActive) {
          this.deactivateScanner();
        } else {
          this.activateScanner();
        }
      } else {
        this.activateScanner();
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleMouseUp(event) {
    if (this.settings.toggleActivation) {
      return;
    }
    const [inputType, inputValue] = this.settings.triggerInput.split(":");

    if (inputType === "mouse" && event.button === parseInt(inputValue, 10)) {
      this.deactivateScanner();

      event.preventDefault();
      event.stopPropagation();
    }
  }

  handleMouseMove(event) {
    this.mousePosition = { x: event.clientX, y: event.clientY };

    // Update popup position if active and we have an overlay showing
    if (this.isActive && this.currentOverlay) {
      // Throttle to animation frame
      if (!this._positionRaf) {
        this._positionRaf = requestAnimationFrame(() => {
          this.updateOverlayPosition();
          this._positionRaf = 0;
        });
      }
    }

    // If extension is not active, immediately stop all processing
    if (!this.isActive) {
      return;
    }

    // Temporarily hide overlay to avoid interfering with elementFromPoint
    const overlayWasVisible =
      this.currentOverlay && this.currentOverlay.style.display !== "none";
    if (overlayWasVisible) {
      this.currentOverlay.style.display = "none";
    }

    // Determine element under cursor
    const el = document.elementFromPoint(event.clientX, event.clientY);

    // Restore overlay
    if (overlayWasVisible) {
      this.currentOverlay.style.display = "block";
    }
    // Prefer a real <img>, but fall back to elements with background-image
    let img = this.imageScanner.findClosestImage(el);
    if (!img) {
      img = this.imageScanner.findElementWithBackgroundImage(el);
    }

    if (img && img !== this.hoveredImage) {
      this.hoveredImage = img;
      this.currentImageSrc = this.imageScanner.getImageSourceKey(img);
      this.lastImageHoverTime = Date.now();
      this.showIndicatorMode = false;
      this.imageScanner.ensureImagePreviewCache(img);

      // Show hover menu for the image
      if (
        this.hoverMenu &&
        typeof this.hoverMenu.getIsActive === "function" &&
        typeof this.hoverMenu.showMenu === "function" &&
        !this.hoverMenu.getIsActive()
      ) {
        // Get cached detection result for this image
        const cached =
          this.currentImageSrc &&
          this.imageScanner.detectionCache.get(this.currentImageSrc);
        // Only show hover menu if there are actual detection results
        if (cached && this.imageScanner.hasValidDetections(cached)) {
          this.hoverMenu.showMenu(img, event.clientX, event.clientY, cached);
        } else {
          // Show no detection message if no results or no detections
          this.hoverMenu.showMenu(img, event.clientX, event.clientY, cached);
        }
      }

      // If we have cached detections, render immediately
      const cached =
        this.currentImageSrc &&
        this.imageScanner.detectionCache.get(this.currentImageSrc);
      if (cached) {
        // Only render if not already rendered for this src
        if (this.lastOverlaySrc !== this.currentImageSrc) {
          this.showOverlay(cached);
        }
      } else {
        // Show thumbnail without boxes while loading (once per src)
        if (this.lastOverlaySrc !== this.currentImageSrc) {
          this.showOverlay(null);
        }
        // Start detection async (debounced by isProcessing)
        this.imageScanner.startDetectionForCurrentImage();
      }
    }

    if (!img) {
      // Always hide hover menu when not over an image, regardless of cached results
      if (
        this.hoverMenu &&
        typeof this.hoverMenu.getIsActive === "function" &&
        typeof this.hoverMenu.hideMenu === "function" &&
        this.hoverMenu.getIsActive()
      ) {
        this.hoverMenu.hideMenu();
      }

      // Not over an image - check if we should show indicator or keep cached results
      const now = Date.now();
      const timeSinceLastHover = now - this.lastImageHoverTime;

      // Check if we have any cached detection results
      const hasAnyCachedResults = this.imageScanner.detectionCache.size > 0;

      // If we have cached results, be much more persistent about showing them
      if (hasAnyCachedResults && !this.showIndicatorMode) {
        const closestImg = this.imageScanner.findClosestImageFromPoint(
          event.clientX,
          event.clientY,
          300
        );
        if (closestImg && this.imageScanner.getImageSourceKey(closestImg)) {
          const srcKey = this.imageScanner.getImageSourceKey(closestImg);
          const cached = this.imageScanner.detectionCache.get(srcKey);
          if (
            cached &&
            this.lastOverlaySrc !== srcKey &&
            this.imageScanner.hasValidDetections(cached)
          ) {
            // Show cached detection results for nearby image
            this.hoveredImage = closestImg;
            this.currentImageSrc = srcKey;

            // Show hover menu for the nearby image only if there are actual detections
            if (
              this.hoverMenu &&
              typeof this.hoverMenu.getIsActive === "function" &&
              typeof this.hoverMenu.showMenu === "function" &&
              !this.hoverMenu.getIsActive()
            ) {
              this.hoverMenu.showMenu(
                closestImg,
                event.clientX,
                event.clientY,
                cached
              );
            }

            this.showOverlay(cached);
            return;
          }
        }
      }

      // If we recently hovered over an image (within 10 seconds) or have cached results,
      // try to find the closest image and show its cached detection results
      if (
        (timeSinceLastHover < 10000 || hasAnyCachedResults) &&
        !this.showIndicatorMode
      ) {
        const closestImg = this.imageScanner.findClosestImageFromPoint(
          event.clientX,
          event.clientY,
          200
        );
        if (closestImg && this.imageScanner.getImageSourceKey(closestImg)) {
          const srcKey = this.imageScanner.getImageSourceKey(closestImg);
          const cached = this.imageScanner.detectionCache.get(srcKey);
          if (
            cached &&
            this.lastOverlaySrc !== srcKey &&
            this.imageScanner.hasValidDetections(cached)
          ) {
            // Show cached detection results for nearby image
            this.hoveredImage = closestImg;
            this.currentImageSrc = srcKey;

            // Show hover menu for the nearby image only if there are actual detections
            if (
              this.hoverMenu &&
              typeof this.hoverMenu.getIsActive === "function" &&
              typeof this.hoverMenu.showMenu === "function" &&
              !this.hoverMenu.getIsActive()
            ) {
              this.hoverMenu.showMenu(
                closestImg,
                event.clientX,
                event.clientY,
                cached
              );
            }

            this.showOverlay(cached);
            return;
          }
        }
      }

      // No nearby images with cached results - show simple indicator
      this.hoveredImage = null;
      this.currentImageSrc = "";
      this.showIndicatorMode = true;

      // Only show indicator once to avoid constant updates
      if (this.lastOverlaySrc !== "indicator") {
        this.showOverlay(null);
        this.lastOverlaySrc = "indicator";
      }
      return;
    }

    // Update canvas overlay position if we have an image with detection results (in case page scrolled)
    if (this.hoveredImage && this.imageScanner.imageCanvasOverlay) {
      // Check if we have cached detection results for this image
      const src = this.imageScanner.getImageSourceKey(this.hoveredImage);
      const hasCachedResults = src && this.imageScanner.detectionCache.has(src);

      if (hasCachedResults) {
        this.imageScanner.updateImageCanvasPosition();
      }
    }
  }

  handleSelectionChange() {
    if (!this.settings.enableSummarization) {
      return;
    }

    if (this.selectionChangeTimeout) {
      clearTimeout(this.selectionChangeTimeout);
    }

    this.selectionChangeTimeout = window.setTimeout(() => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) {
        this.clearSelectionState();
        if (this.summaryModeActive) {
          this.exitSummaryMode();
        }
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        this.clearSelectionState();
        if (this.summaryModeActive) {
          this.exitSummaryMode();
        }
        return;
      }

      const truncated = text.slice(0, this.maxSummaryInputChars);
      this.currentSelectionRawText = text;
      this.currentSelectionText = truncated;
      this.currentSelectionPreview = this.buildSelectionPreview(text);
      this.currentSelectionKey = this.generateSummaryKey(truncated);
      this.currentSelectionRect = this.computeSelectionRect(selection);
    }, 120);
  }

  ensureSelectionState() {
    if (this.currentSelectionText) {
      return;
    }

    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      return;
    }

    const truncated = text.slice(0, this.maxSummaryInputChars);
    this.currentSelectionRawText = text;
    this.currentSelectionText = truncated;
    this.currentSelectionPreview = this.buildSelectionPreview(text);
    this.currentSelectionKey = this.generateSummaryKey(truncated);
    this.currentSelectionRect = this.computeSelectionRect(selection);
  }

  clearSelectionState() {
    this.currentSelectionText = "";
    this.currentSelectionRawText = "";
    this.currentSelectionPreview = "";
    this.currentSelectionKey = "";
    this.currentSelectionRect = null;
  }

  buildSelectionPreview(text) {
    if (!text) return "";
    const trimmed = text.trim().replace(/\s+/g, " ");
    const maxPreview = 160;
    return trimmed.length > maxPreview
      ? `${trimmed.slice(0, maxPreview)}…`
      : trimmed;
  }

  computeSelectionRect(selection = null) {
    try {
      const sel = selection || document.getSelection();
      if (!sel || sel.rangeCount === 0) {
        return null;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) {
        return rect;
      }

      const clientRects = range.getClientRects();
      if (clientRects && clientRects.length) {
        return clientRects[0];
      }
    } catch (error) {
      // Ignore selection measurement errors
    }
    return null;
  }

  generateSummaryKey(text) {
    const normalized = (text || "").trim().replace(/\s+/g, " ");
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      hash = (hash << 5) - hash + normalized.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return `${normalized.length}:${Math.abs(hash)}`;
  }

  extractTextFromPage() {
    // Clone the body to avoid modifying the original
    const clone = document.body.cloneNode(true);

    // Remove script and style elements
    const scripts = clone.querySelectorAll("script, style, noscript");
    scripts.forEach((el) => el.remove());

    // Get text content
    const text = clone.innerText || clone.textContent || "";

    // Clean up: remove extra whitespace, normalize line breaks
    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }

  async scanFullPageText() {
    if (!this.settings.enableSummarization) {
      console.warn("Summarization is not enabled");
      return;
    }

    try {
      const fullText = this.extractTextFromPage();
      if (!fullText || fullText.length < this.settings.minSummaryChars) {
        console.warn("Page text is too short or empty");
        return;
      }

      // Truncate if too long
      const truncated = fullText.slice(0, this.maxSummaryInputChars);
      const summaryKey = this.generateSummaryKey(truncated);

      // Check cache first
      const cached = this.summaryCache.get(summaryKey);
      if (cached) {
        this.currentSummaryResult = cached;
        this.currentSummaryResult = cached;
        this.summaryErrorMessage = "";
        this.summaryModeActive = true;
        this.currentSelectionText = truncated;
        this.currentSelectionRawText = fullText;
        this.currentSelectionPreview = this.buildSelectionPreview(fullText);
        this.currentSelectionKey = summaryKey;
        this.activeSummaryKey = summaryKey;
        this.showSummaryOverlay();
        return;
      }

      // Show loading state
      this.summaryModeActive = true;
      this.currentSelectionText = truncated;
      this.currentSelectionRawText = fullText;
      this.currentSelectionPreview = this.buildSelectionPreview(fullText);
      this.currentSelectionKey = summaryKey;
      this.activeSummaryKey = summaryKey;
      this.currentSummaryResult = null;
      this.summaryErrorMessage = "";
      this.isSummarizingText = true;
      this.showSummaryOverlay();

      // Fetch summary
      await this.fetchSummaryForSelection(truncated, summaryKey);
    } catch (error) {
      console.log("Error scanning full page text:", error);
      this.summaryErrorMessage = error?.message || "Failed to scan page text";
      this.isSummarizingText = false;
      this.showSummaryOverlay();
    }
  }

  processTextSummaryFlow(forceImmediate = false) {
    if (!this.settings.enableSummarization) {
      return false;
    }

    if (!this.isActive) {
      return false;
    }

    this.ensureSelectionState();
    const text = (this.currentSelectionText || "").trim();

    if (!text || text.length < this.settings.minSummaryChars) {
      if (forceImmediate && this.summaryModeActive) {
        this.exitSummaryMode();
      }
      return false;
    }

    const summaryKey =
      this.currentSelectionKey || this.generateSummaryKey(text);
    this.activeSummaryKey = summaryKey;
    this.summaryModeActive = true;
    const cached = this.summaryCache.get(summaryKey);

    if (cached) {
      this.currentSummaryResult = cached;
      this.summaryErrorMessage = "";
    } else {
      this.currentSummaryResult = null;
      this.summaryErrorMessage = "";
      if (this.summaryInFlightKey !== summaryKey && !this.isSummarizingText) {
        this.fetchSummaryForSelection(text, summaryKey);
      }
    }

    this.showSummaryOverlay();
    return true;
  }

  async fetchSummaryForSelection(text, summaryKey) {
    try {
      this.summaryInFlightKey = summaryKey;
      this.isSummarizingText = true;
      const requestId = ++this.summaryRequestSeq;
      const payload = this.buildSummarizationPayload(text);
      const response = await fetch(this.settings.summarizationEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Summarization request failed (${response.status})`);
      }

      const data = await response.json();
      const summaryText = this.extractSummaryFromResponse(data);
      if (!summaryText) {
        throw new Error("Summarization provider returned an empty response");
      }

      if (
        this.summaryInFlightKey !== summaryKey ||
        requestId !== this.summaryRequestSeq
      ) {
        return;
      }

      const result = {
        summary: summaryText.trim(),
        model: this.settings.summarizationModel,
      };

      this.summaryCache.set(summaryKey, result);
      if (this.summaryCache.size > this.summaryCacheMaxSize) {
        const firstKey = this.summaryCache.keys().next().value;
        this.summaryCache.delete(firstKey);
      }

      this.currentSummaryResult = result;
      this.summaryErrorMessage = "";
    } catch (error) {
      if (this.summaryInFlightKey === summaryKey) {
        this.currentSummaryResult = null;
        this.summaryErrorMessage = error?.message || "Summarization failed";
      }
    } finally {
      if (this.summaryInFlightKey === summaryKey) {
        this.summaryInFlightKey = "";
        this.isSummarizingText = false;
        this.showSummaryOverlay();
      }
    }
  }

  buildSummarizationPayload(text) {
    const systemPrompt =
      "You write concise, user-friendly summaries for website text. Always start with between 1 and 5 emojis which best represent the text as a miniature sentiment analysis without the use of words. Only use emojis at very start then add a separator line ------ and follow up with the actual summary. Keep summary very short around 30 to 75 words max.";

    // OpenAI-style chat / Ollama payload
    const baseMessages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: ` Here is the text: \n\n${text}`,
      },
    ];

    // Special-case LM Studio: always behave as a one-shot response.
    // For Nemotron in LM Studio, use classic chat-completions payload with `messages`.
    if (this.settings.summarizationProvider === "lmstudio") {
      return {
        model: this.settings.summarizationModel,
        messages: baseMessages,
        temperature: 0.3,
        // IMPORTANT: do not send a "reasoning" field so LM Studio keeps reasoning disabled
        stream: false,
      };
    }

    if (this.settings.summarizationProvider === "ollama") {
      return {
        model: this.settings.summarizationModel,
        stream: false,
        messages: baseMessages,
        options: { temperature: 0.3 },
      };
    }

    // Default: OpenAI compatible chat completions
    return {
      model: this.settings.summarizationModel,
      temperature: 0.3,
      messages: baseMessages,
      reasoning: false,
    };
  }

  extractSummaryFromResponse(data) {
    if (!data) {
      return "";
    }

    // First, handle LM Studio / OpenAI "responses" style payloads
    // See: https://lmstudio.ai/docs/developer/openai-compat/responses
    if (Array.isArray(data.output_text) && data.output_text.length > 0) {
      const first = data.output_text[0];

      // LM Studio mirrors OpenAI Responses: each output_text item has a content array
      if (Array.isArray(first.content)) {
        const combined = first.content
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n");
        if (combined.trim()) {
          return this.postProcessSummary(combined);
        }
      }

      if (typeof first.text === "string" && first.text.trim()) {
        return this.postProcessSummary(first.text);
      }
    }

    if (Array.isArray(data.output) && data.output.length > 0) {
      const firstOut = data.output[0];
      if (Array.isArray(firstOut.content)) {
        const combined = firstOut.content
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("\n");
        if (combined.trim()) {
          return this.postProcessSummary(combined);
        }
      }
    }

    // Fallback: classic chat-completions shape (OpenAI, LM Studio /v1/chat/completions, etc.)
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice.message && typeof choice.message.content === "string") {
        return this.postProcessSummary(choice.message.content);
      }
      if (Array.isArray(choice.message?.content)) {
        const concatenated = choice.message.content
          .map((part) => part.text || "")
          .join("\n");
        return this.postProcessSummary(concatenated);
      }
      if (typeof choice.text === "string") {
        return this.postProcessSummary(choice.text);
      }
    }

    if (data.message && typeof data.message.content === "string") {
      return this.postProcessSummary(data.message.content);
    }

    if (typeof data.response === "string") {
      return this.postProcessSummary(data.response);
    }

    return "";
  }

  postProcessSummary(text) {
    if (!text) {
      return "";
    }

    let cleaned = text;

    // For LM Studio (or whenever reasoning is disabled), strip out any
    // visible thinking/reasoning tags that some models may emit.
    if (
      this.settings.summarizationProvider === "lmstudio" ||
      this.settings.reasoning === false
    ) {
      // Remove <think>...</think> and <thinking>...</thinking> blocks
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
      cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

      // Remove obvious "Reasoning:" sections before the visible answer.
      cleaned = cleaned.replace(
        /Reasoning:\s*[\s\S]*?(?:-----|\n-{2,}\n)/i,
        ""
      );
    }

    return cleaned.trim();
  }

  showSummaryOverlay() {
    if (!this.currentOverlay) {
      return;
    }

    this.summaryModeActive = true;
    this.imageScanner.removeImageCanvasOverlay();
    this.imageScanner.stopCrawlingAnimation();

    this.updateSummaryOverlayContent();
    this.currentOverlay.style.display = "block";
    this.currentOverlay.style.pointerEvents = "none";

    requestAnimationFrame(() => {
      this.updateSummaryOverlayPosition();
    });
  }

  updateSummaryOverlayContent() {
    if (!this.currentOverlay) {
      return;
    }

    this.currentOverlay.innerHTML = "";

    const box = document.createElement("div");
    box.style.background = "rgba(15, 23, 42, 0.95)";
    box.style.color = "#e2e8f0";
    box.style.borderRadius = "10px";
    box.style.padding = "14px";
    box.style.maxWidth = "360px";
    box.style.minWidth = "260px";
    box.style.boxShadow = "0 20px 40px rgba(15,23,42,0.35)";
    box.style.border = "1px solid rgba(148, 163, 184, 0.35)";
    box.style.fontFamily = "'Segoe UI', sans-serif";

    const title = document.createElement("div");
    title.textContent =
      this.currentSelectionRawText &&
      this.currentSelectionRawText.length > this.maxSummaryInputChars
        ? "Full page summary"
        : "Text summary";
    title.style.fontWeight = "600";
    title.style.fontSize = "14px";
    title.style.marginBottom = "6px";
    title.style.letterSpacing = "0.02em";
    box.appendChild(title);

    if (this.currentSelectionPreview) {
      const preview = document.createElement("div");
      preview.textContent = this.currentSelectionPreview;
      preview.style.fontSize = "13px";
      preview.style.color = "#94a3b8";
      preview.style.marginBottom = "10px";
      preview.style.lineHeight = "1.3";
      box.appendChild(preview);
    }

    const body = document.createElement("div");
    body.style.fontSize = "14px";
    body.style.lineHeight = "1.5";

    if (this.summaryErrorMessage) {
      body.textContent = this.summaryErrorMessage;
      body.style.color = "#f87171";
    } else if (this.currentSummaryResult?.summary) {
      body.textContent = this.currentSummaryResult.summary;
      body.style.color = "#e2e8f0";
    } else if (this.isSummarizingText) {
      body.textContent = "Summarizing selection…";
      body.style.color = "#cbd5f5";
    } else {
      body.textContent =
        "Highlight text and hold the trigger key to summarize.";
      body.style.color = "#cbd5f5";
    }

    box.appendChild(body);

    if (this.currentSummaryResult?.model) {
      const meta = document.createElement("div");
      meta.textContent = `${this.settings.summarizationProvider} · ${this.currentSummaryResult.model}`;
      meta.style.fontSize = "11px";
      meta.style.marginTop = "8px";
      meta.style.textTransform = "uppercase";
      meta.style.letterSpacing = "0.08em";
      meta.style.color = "#64748b";
      box.appendChild(meta);
    }

    this.currentOverlay.appendChild(box);
  }

  updateSummaryOverlayPosition() {
    if (!this.currentOverlay || !this.summaryModeActive) {
      return;
    }

    const latestRect = this.computeSelectionRect();
    if (latestRect) {
      this.currentSelectionRect = latestRect;
    }

    let left = this.mousePosition.x + 16;
    let top = this.mousePosition.y - 20;

    if (this.currentSelectionRect) {
      left =
        this.currentSelectionRect.left + this.currentSelectionRect.width + 16;
      top = this.currentSelectionRect.top - 10;
    }

    const overlayRect = this.currentOverlay.getBoundingClientRect();
    const width = overlayRect.width || 320;
    const height = overlayRect.height || 160;
    const maxLeft = window.innerWidth - width - 12;
    const maxTop = window.innerHeight - height - 12;

    const clampedLeft = Math.max(8, Math.min(left, maxLeft));
    const clampedTop = Math.max(8, Math.min(top, maxTop));

    this.currentOverlay.style.left = `${clampedLeft}px`;
    this.currentOverlay.style.top = `${clampedTop}px`;
  }

  exitSummaryMode() {
    if (!this.summaryModeActive && !this.activeSummaryKey) {
      this.summaryErrorMessage = "";
      this.summaryInFlightKey = "";
      return;
    }

    this.summaryModeActive = false;
    this.currentSummaryResult = null;
    this.summaryErrorMessage = "";
    this.activeSummaryKey = "";
    this.summaryInFlightKey = "";
    this.isSummarizingText = false;
    if (this.currentOverlay) {
      this.currentOverlay.innerHTML = "";
    }
  }

  hideOverlay() {
    if (this.currentOverlay) {
      this.currentOverlay.style.display = "none";
      this.currentOverlay.innerHTML = ""; // Clear content
    }
    this.imageScanner.removeImageCanvasOverlay();
    this.hoveredImage = null;
    this.overlayBoxEl = null;
    this.lastOverlaySrc = ""; // Reset to empty string so indicator can be shown again
    this.isUpdatingOverlay = false; // Reset updating flag
    this.imageScanner.stopCrawlingAnimation();
  }

  showOverlay(detectionResult) {
    if (!this.currentOverlay) {
      return;
    }

    // Update content and position
    this.updateOverlayContent(detectionResult);

    // Update position based on what we're showing
    if (this.hoveredImage && detectionResult) {
      // We have an image and detection results - update position relative to mouse
      this.updateOverlayPosition();
      // Also ensure the canvas overlay on the image is visible
      if (
        detectionResult &&
        detectionResult.data &&
        detectionResult.data.length > 0
      ) {
        this.imageScanner.showImageCanvasOverlay(
          this.hoveredImage,
          detectionResult
        );
        this.imageScanner.startCrawlingAnimation();
      }
    } else if (!this.hoveredImage && !detectionResult) {
      // Simple indicator - position directly at mouse
      this.updateOverlayPosition();
      this.imageScanner.stopCrawlingAnimation();
    }

    // Force display to block
    this.currentOverlay.style.display = "block";
  }

  updateOverlayPosition() {
    if (!this.currentOverlay) {
      return;
    }

    // Check if this is the simple indicator (no hovered image)
    const isSimpleIndicator = !this.hoveredImage;

    if (isSimpleIndicator) {
      // Position simple indicator directly at mouse cursor
      this.currentOverlay.style.position = "fixed";
      this.currentOverlay.style.left = this.mousePosition.x + "px";
      this.currentOverlay.style.top = this.mousePosition.y + "px";
      this.currentOverlay.style.zIndex = "999999";
      this.currentOverlay.style.pointerEvents = "none";
      this.imageScanner.stopCrawlingAnimation();
      return;
    }

    // Check if we're showing cached detection results (mouse might not be directly over image)
    const src = this.hoveredImage
      ? this.imageScanner.getImageSourceKey(this.hoveredImage)
      : "";
    const hasCachedResults = src && this.imageScanner.detectionCache.has(src);

    if (hasCachedResults) {
      // Position overlay to the right of mouse cursor (with small offset to avoid blocking view)
      const offsetX = 20;
      const offsetY = -10; // Slightly above the cursor

      this.currentOverlay.style.position = "fixed";
      this.currentOverlay.style.left = this.mousePosition.x + offsetX + "px";
      this.currentOverlay.style.top = this.mousePosition.y + offsetY + "px";
      this.currentOverlay.style.zIndex = "999999";
      this.currentOverlay.style.pointerEvents = "none";
      this.imageScanner.startCrawlingAnimation();
      return;
    }

    // Default positioning for regular image overlays
    const offsetX = 20;
    const offsetY = -10; // Slightly above the cursor

    this.currentOverlay.style.position = "fixed";
    this.currentOverlay.style.left = this.mousePosition.x + offsetX + "px";
    this.currentOverlay.style.top = this.mousePosition.y + offsetY + "px";
    this.currentOverlay.style.zIndex = "999999";
    this.currentOverlay.style.pointerEvents = "none";
    this.imageScanner.stopCrawlingAnimation();
  }

  updateOverlayContent(detectionResult) {
    if (!this.currentOverlay) {
      return;
    }

    // Prevent concurrent updates
    if (this.isUpdatingOverlay) {
      return;
    }

    this.isUpdatingOverlay = true;

    try {
      // Current src we're showing
      const src = this.hoveredImage
        ? this.imageScanner.getImageSourceKey(this.hoveredImage)
        : "";

      // If overlay for this src already exists, just redraw boxes and return
      if (this.overlayBoxEl && this.lastOverlaySrc === src) {
        if (this.overlayCanvasEl && this.thumbnailImgEl) {
          const canvas = this.overlayCanvasEl;
          const thumb = this.thumbnailImgEl;
          const rectW = thumb.clientWidth;
          const rectH = thumb.clientHeight;
          canvas.width = rectW;
          canvas.height = rectH;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, rectW, rectH);
          if (
            detectionResult &&
            detectionResult.data &&
            detectionResult.data.length
          ) {
            detectionResult.data.forEach((obj) => {
              const x = (obj.x / 100) * rectW;
              const y = (obj.y / 100) * rectH;
              const width = (obj.width / 100) * rectW;
              const height = (obj.height / 100) * rectH;
              ctx.strokeStyle = obj.color || "#00FF00";
              ctx.lineWidth = 3;
              ctx.strokeRect(x, y, width, height);
              if (obj.confidence) {
                ctx.fillStyle = obj.color || "#00FF00";
                ctx.font = "12px Arial";
                ctx.fillText(
                  `${obj.type} ${(obj.confidence * 100).toFixed(0)}%`,
                  x,
                  Math.max(12, y - 4)
                );
              }
            });
          }
        }
        return;
      }

      // Clear previous content
      this.currentOverlay.innerHTML = "";

      // Check if this is for a hovered image or just an indicator
      if (!src && !detectionResult) {
        // Simple indicator when not hovering over an image
        const indicator = document.createElement("div");
        indicator.textContent = "no image";
        indicator.style.width = "50px";
        indicator.style.height = "25px";
        indicator.style.background = "white";
        indicator.style.border = "1px solid rgba(0,0,0,0.15)";
        indicator.style.borderRadius = "3px";
        indicator.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
        indicator.style.display = "flex";
        indicator.style.alignItems = "center";
        indicator.style.justifyContent = "center";
        indicator.style.fontSize = "10px";
        indicator.style.fontFamily = "Arial, sans-serif";
        indicator.style.fontWeight = "bold";
        indicator.style.color = "#333";
        indicator.style.left = "12px";
        indicator.style.position = "relative";
        indicator.style.pointerEvents = "none";

        this.currentOverlay.appendChild(indicator);
        this.overlayBoxEl = indicator;
        this.lastOverlaySrc = src;
        return;
      }

      // Outer box styling for image overlays
      const box = document.createElement("div");
      box.style.pointerEvents = "none";
      box.style.background = "white";
      box.style.border = "1px solid rgba(0,0,0,0.15)";
      box.style.borderRadius = "6px";
      box.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
      box.style.padding = "6px";
      box.style.maxWidth = "400px";
      box.style.maxHeight = "400px";

      // Wrapper to stack thumbnail and canvas
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.style.display = "inline-block";
      wrapper.style.maxWidth = "400px";
      wrapper.style.maxHeight = "400px";

      // Show detection outlines on thumbnail instead of menu options
      if (
        detectionResult &&
        detectionResult.data &&
        detectionResult.data.length > 0
      ) {
        // Create thumbnail with detection boxes
        const thumb = document.createElement("img");
        this.thumbnailImgEl = thumb;
        if (src) {
          const previewSrc =
            this.imageScanner.getCachedImagePreview(src) || src;
          thumb.src = previewSrc;
        }
        thumb.style.display = "block";
        thumb.style.maxWidth = "400px";
        thumb.style.maxHeight = "400px";
        thumb.style.width = "auto";
        thumb.style.height = "auto";
        thumb.style.borderRadius = "4px";

        // Canvas overlay for detection boxes
        const canvas = document.createElement("canvas");
        canvas.className = "detection-canvas";
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        this.overlayCanvasEl = canvas;

        const drawBoxes = () => {
          const rectW = thumb.clientWidth;
          const rectH = thumb.clientHeight;
          canvas.width = rectW;
          canvas.height = rectH;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, rectW, rectH);

          detectionResult.data.forEach((obj) => {
            const x = (obj.x / 100) * rectW;
            const y = (obj.y / 100) * rectH;
            const width = (obj.width / 100) * rectW;
            const height = (obj.height / 100) * rectH;
            ctx.strokeStyle = obj.color || "#00FF00";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, width, height);
            if (obj.confidence) {
              ctx.fillStyle = obj.color || "#00FF00";
              ctx.font = "12px Arial";
              ctx.fillText(
                `${obj.type} ${(obj.confidence * 100).toFixed(0)}%`,
                x,
                Math.max(12, y - 4)
              );
            }
          });
        };

        thumb.addEventListener(
          "load",
          () => {
            canvas.width = thumb.clientWidth;
            canvas.height = thumb.clientHeight;
            drawBoxes();
          },
          { once: true }
        );

        // If the image is already loaded (cached), draw immediately
        if (thumb.complete && thumb.naturalWidth > 0) {
          canvas.width = thumb.clientWidth;
          canvas.height = thumb.clientHeight;
          drawBoxes();
        }

        wrapper.appendChild(thumb);
        wrapper.appendChild(canvas);
        box.appendChild(wrapper);
      } else {
        // Show thumbnail without detection boxes (for cross-origin images or when detection fails)
        if (src) {
          const thumb = document.createElement("img");
          this.thumbnailImgEl = thumb;
          const previewSrc =
            this.imageScanner.getCachedImagePreview(src) || src;
          thumb.src = previewSrc;
          thumb.style.display = "block";
          thumb.style.maxWidth = "400px";
          thumb.style.maxHeight = "400px";
          thumb.style.width = "auto";
          thumb.style.height = "auto";
          thumb.style.borderRadius = "4px";

          thumb.addEventListener(
            "load",
            () => {
              // Thumbnail loaded successfully
            },
            { once: true }
          );

          thumb.addEventListener(
            "error",
            () => {
              // Thumbnail failed to load, show text message instead
              const message = document.createElement("div");
              message.textContent = "Image preview unavailable";
              message.style.padding = "12px 16px";
              message.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
              message.style.color = "white";
              message.style.borderRadius = "8px";
              message.style.fontSize = "14px";
              message.style.fontFamily = "Arial, sans-serif";
              message.style.textAlign = "center";
              message.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
              message.style.border = "1px solid rgba(255, 255, 255, 0.2)";
              message.style.backdropFilter = "blur(10px)";
              message.style.userSelect = "none";
              message.style.pointerEvents = "none";

              box.innerHTML = "";
              box.appendChild(message);
            },
            { once: true }
          );

          wrapper.appendChild(thumb);
          box.appendChild(wrapper);
        } else {
          // No detection results and no image source - show text message
          const message = document.createElement("div");
          message.textContent = "No image preview available";
          message.style.padding = "12px 16px";
          message.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
          message.style.color = "white";
          message.style.borderRadius = "8px";
          message.style.fontSize = "14px";
          message.style.fontFamily = "Arial, sans-serif";
          message.style.textAlign = "center";
          message.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
          message.style.border = "1px solid rgba(255, 255, 255, 0.2)";
          message.style.backdropFilter = "blur(10px)";
          message.style.userSelect = "none";
          message.style.pointerEvents = "none";

          box.appendChild(message);
        }
      }
    } finally {
      this.isUpdatingOverlay = false;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new ImageAIHover();
  });
} else {
  new ImageAIHover();
}
