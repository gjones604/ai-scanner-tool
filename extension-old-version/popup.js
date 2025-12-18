/* global chrome */
class ExtensionPopup {
  constructor() {
    this.settings = {
      triggerInput: "keyboard:Shift",
      detectionEndpoint: "http://localhost:8001/api/detect-base64",
      theme: "default",
      showCrawlingLines: true,
      enableSummarization: true,
      summarizationProvider: "lmstudio",
      // Default LM Studio text endpoint: use chat completions; we still treat it as one-shot.
      summarizationEndpoint: "http://127.0.0.1:1234/v1/chat/completions",
      summarizationModel: "nvidia/nemotron-3-nano",
      minSummaryChars: 40,
      toggleActivation: false,
      reasoning: false,
    };

    this.serverReachable = true;

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
    this.loadAvailableModels();
    this.testConnection();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        "triggerInput",
        "detectionEndpoint",
        "theme",
        "showCrawlingLines",
        "enableSummarization",
        "summarizationProvider",
        "summarizationEndpoint",
        "summarizationModel",
        "minSummaryChars",
        "toggleActivation",
        "reasoning",
      ]);
      this.settings.triggerInput = "keyboard:Shift";
      if (result.detectionEndpoint)
        this.settings.detectionEndpoint = result.detectionEndpoint;
      if (result.theme) this.settings.theme = result.theme;
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
      this.updateExtensionIcon();
    } catch (error) {
      console.log("Using default settings");
    }
  }

  setupEventListeners() {
    // Save button
    document.getElementById("save-btn").addEventListener("click", () => {
      this.saveSettings();
    });

    // Test connection button
    document.getElementById("test-btn").addEventListener("click", () => {
      this.testConnection();
    });

    // API URL input
    document
      .getElementById("detection-endpoint")
      .addEventListener("input", (e) => {
        this.settings.detectionEndpoint = e.target.value;
        this.updateExtensionIcon();
      });

    const summarizationCheckbox = document.getElementById(
      "enable-summarization"
    );
    if (summarizationCheckbox) {
      summarizationCheckbox.addEventListener("change", (e) => {
        this.settings.enableSummarization = !!e.target.checked;
        this.updateExtensionIcon();
        this.toggleSummarizationSettingsVisibility();
      });
    }

    const providerSelect = document.getElementById("summarization-provider");
    if (providerSelect) {
      providerSelect.addEventListener("change", (e) => {
        this.settings.summarizationProvider = e.target.value;
      });
    }

    const summarizationEndpoint = document.getElementById(
      "summarization-endpoint"
    );
    if (summarizationEndpoint) {
      summarizationEndpoint.addEventListener("input", (e) => {
        this.settings.summarizationEndpoint = e.target.value;
      });
    }

    const summarizationModel = document.getElementById("summarization-model");
    if (summarizationModel) {
      summarizationModel.addEventListener("input", (e) => {
        this.settings.summarizationModel = e.target.value;
      });
    }

    const minSummaryCharsInput = document.getElementById("min-summary-chars");
    if (minSummaryCharsInput) {
      minSummaryCharsInput.addEventListener("input", (e) => {
        const value = parseInt(e.target.value, 10);
        if (!Number.isNaN(value) && value > 0) {
          this.settings.minSummaryChars = value;
        }
      });
    }

    const toggleActivationCheckbox =
      document.getElementById("toggle-activation");
    if (toggleActivationCheckbox) {
      toggleActivationCheckbox.addEventListener("change", (e) => {
        this.settings.toggleActivation = !!e.target.checked;
      });
    }

    // Theme selector
    document
      .getElementById("theme-selector")
      .addEventListener("change", (e) => {
        this.selectTheme(e.target.value);
      });

    // Crawling lines checkbox
    const crawlCheckbox = document.getElementById("show-crawling-lines");
    if (crawlCheckbox) {
      crawlCheckbox.addEventListener("change", (e) => {
        this.settings.showCrawlingLines = !!e.target.checked;
      });
    }

    // Scan full page text button
    const scanPageBtn = document.getElementById("scan-page-btn");
    if (scanPageBtn) {
      scanPageBtn.addEventListener("click", () => {
        this.scanFullPageText();
      });
    }
  }

  async scanFullPageText() {
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab || !tab.id) {
        console.log("No active tab found");
        return;
      }

      // Send message to content script
      await chrome.tabs.sendMessage(tab.id, { type: "SCAN_FULL_PAGE_TEXT" });

      // Show feedback
      this.showStatus("Scanning page text...", "connected");

      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 500);
    } catch (error) {
      console.log("Error scanning full page text:", error);
      this.showStatus("Failed to scan page", "disconnected");
    }
  }

  selectTheme(theme) {
    this.settings.theme = theme;
    this.applyTheme(theme);
  }

  applyTheme(theme) {
    const container = document.querySelector(".image-ai-hover.container");

    // Remove all theme classes
    container.className = container.className.replace(/theme-\w+/g, "").trim();

    // Add new theme class
    if (theme !== "default") {
      container.classList.add(`theme-${theme}`);
    }
  }

  async loadAvailableModels() {
    // Only attempt auto-discovery for LM Studio
    if (this.settings.summarizationProvider !== "lmstudio") {
      return;
    }

    const datalist = document.getElementById("summarization-model-list");
    if (!datalist) {
      return;
    }

    try {
      let modelsUrl = "http://127.0.0.1:1234/v1/models";
      try {
        if (this.settings.summarizationEndpoint) {
          const url = new URL(this.settings.summarizationEndpoint);
          modelsUrl = `${url.origin}/v1/models`;
        }
      } catch (e) {
        // Fallback to default LM Studio endpoint
      }

      const response = await fetch(modelsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const models = Array.isArray(data.data) ? data.data : [];

      datalist.innerHTML = "";

      models.forEach((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        if (!id) return;
        const option = document.createElement("option");
        option.value = id;
        datalist.appendChild(option);
      });
    } catch (error) {
      // If model discovery fails, we simply leave the list empty and allow manual entry
      console.log("Failed to load LM Studio models:", error);
    }
  }

  updateUI() {
    // Update API URL input
    document.getElementById("detection-endpoint").value =
      this.settings.detectionEndpoint;

    const summarizationCheckbox = document.getElementById(
      "enable-summarization"
    );
    if (summarizationCheckbox) {
      summarizationCheckbox.checked = !!this.settings.enableSummarization;
    }

    const providerSelect = document.getElementById("summarization-provider");
    if (providerSelect) {
      providerSelect.value = this.settings.summarizationProvider;
    }

    const summarizationEndpoint = document.getElementById(
      "summarization-endpoint"
    );
    if (summarizationEndpoint) {
      summarizationEndpoint.value = this.settings.summarizationEndpoint;
    }

    const summarizationModel = document.getElementById("summarization-model");
    if (summarizationModel) {
      summarizationModel.value = this.settings.summarizationModel;
    }

    const minSummaryCharsInput = document.getElementById("min-summary-chars");
    if (minSummaryCharsInput) {
      minSummaryCharsInput.value = this.settings.minSummaryChars;
    }

    const toggleActivationCheckbox =
      document.getElementById("toggle-activation");
    if (toggleActivationCheckbox) {
      toggleActivationCheckbox.checked = !!this.settings.toggleActivation;
    }

    this.toggleSummarizationSettingsVisibility();

    // Update theme selector and apply theme
    document.getElementById("theme-selector").value = this.settings.theme;
    this.applyTheme(this.settings.theme);

    // Update crawling lines checkbox
    const crawlCheckbox = document.getElementById("show-crawling-lines");
    if (crawlCheckbox)
      crawlCheckbox.checked = !!this.settings.showCrawlingLines;

    // Update scan page button visibility
    const scanPageBtn = document.getElementById("scan-page-btn");
    if (scanPageBtn) {
      scanPageBtn.style.display = this.settings.enableSummarization
        ? "block"
        : "none";
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({
        triggerInput: "keyboard:Shift",
        detectionEndpoint: this.settings.detectionEndpoint,
        theme: this.settings.theme,
        showCrawlingLines: this.settings.showCrawlingLines,
        enableSummarization: this.settings.enableSummarization,
        summarizationProvider: this.settings.summarizationProvider,
        summarizationEndpoint: this.settings.summarizationEndpoint,
        summarizationModel: this.settings.summarizationModel,
        minSummaryChars: this.settings.minSummaryChars,
        toggleActivation: this.settings.toggleActivation,
      });

      this.showStatus("Settings saved successfully!", "connected");
      this.updateExtensionIcon();
    } catch (error) {
      console.log("Failed to save settings:", error);
      this.showStatus("Failed to save settings", "disconnected");
    }
  }

  async testConnection() {
    const statusEl = document.getElementById("status");
    statusEl.textContent = "Testing...";
    statusEl.className = "status";

    try {
      const response = await fetch(
        this.settings.detectionEndpoint.replace(
          "/api/detect-base64",
          "/api/status"
        )
      );
      if (response.ok) {
        this.showStatus("Connected to YOLO server", "connected");
        this.serverReachable = true;
        this.updateExtensionIcon();
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn("Connection test failed:", error);
      this.showStatus("Connection failed - check API URL", "disconnected");
      this.serverReachable = false;
      this.updateExtensionIcon();
    }
  }

  showStatus(message, type) {
    const statusEl = document.getElementById("status");
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }

  // Listen for settings changes from content script
  async checkForSettingsUpdate() {
    // This could be used to refresh settings if changed elsewhere
  }

  determineIconState() {
    if (!this.serverReachable) {
      return "offline";
    }
    const hasDetectionEndpoint = Boolean(
      this.settings.detectionEndpoint && this.settings.detectionEndpoint.trim()
    );
    if (this.settings.enableSummarization && hasDetectionEndpoint) {
      return "both";
    }
    if (this.settings.enableSummarization && !hasDetectionEndpoint) {
      return "text";
    }
    return "images";
  }

  updateExtensionIcon() {
    const state = this.determineIconState();
    try {
      chrome.runtime.sendMessage({ type: "UPDATE_ICON_STATE", state });
    } catch (error) {
      // Ignore icon update errors (extension might not be ready yet)
    }
  }

  toggleSummarizationSettingsVisibility() {
    const container = document.getElementById("summarization-settings");
    if (!container) {
      return;
    }
    container.style.display = this.settings.enableSummarization
      ? "block"
      : "none";

    // Also toggle the scan page button visibility
    const scanPageBtn = document.getElementById("scan-page-btn");
    if (scanPageBtn) {
      scanPageBtn.style.display = this.settings.enableSummarization
        ? "block"
        : "none";
    }
  }
}

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new ExtensionPopup();
});
