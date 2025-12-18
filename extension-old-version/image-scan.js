class ImageScanner {
  constructor(parentInstance) {
    this.parent = parentInstance; // Reference to ImageAIHover instance
    this.detectionCache = new Map();
    this.cacheMaxSize = 50;
    this.imageDataCache = new Map();
    this.failedDetectionCooldowns = new Map();
    this.detectionRetryDelayMs = 1500;
    this.isProcessing = false;
    this.imageCanvasOverlay = null;
    this.crawlingCanvas = null;
    this.crawlingCtx = null;
    this.crawlingAnimRaf = 0;
    this.crawlingDashOffset = 0;
    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;
  }

  getCachedBase64Payload(srcKey) {
    const preview = this.getCachedImagePreview(srcKey);
    if (!preview) {
      return "";
    }
    const commaIndex = preview.indexOf(",");
    if (commaIndex === -1) {
      return "";
    }
    return preview.slice(commaIndex + 1);
  }

  async getOrBuildBase64ForImage(img) {
    const srcKey = this.getImageSourceKey(img);
    if (!srcKey) {
      return "";
    }

    const cachedPayload = this.getCachedBase64Payload(srcKey);
    if (cachedPayload) {
      return cachedPayload;
    }

    const base64 = await this.imageToBase64(img);
    if (base64) {
      this.storeImagePreviewData(srcKey, base64);
    }
    return base64;
  }

  getImageSourceKey(img = null) {
    const target = img || this.parent.hoveredImage;
    if (!target) {
      return "";
    }

    // Prefer native image src/currentSrc when available
    if (target.currentSrc || target.src) {
      return target.currentSrc || target.src || "";
    }

    // Fallback for non-IMG elements that we tagged with a synthetic image src
    if (
      target.__imageAIHoverSrc &&
      typeof target.__imageAIHoverSrc === "string"
    ) {
      return target.__imageAIHoverSrc;
    }

    return "";
  }

  async ensureImagePreviewCache(img) {
    const srcKey = this.getImageSourceKey(img);
    if (!srcKey || this.imageDataCache.has(srcKey)) {
      return srcKey;
    }
    try {
      const base64 = await this.imageToBase64(img);
      if (base64) {
        this.storeImagePreviewData(srcKey, base64);
      }
    } catch (error) {
      // Ignore preview cache failures; detection flow handles errors separately
    }
    return srcKey;
  }

  storeImagePreviewData(srcKey, base64Data) {
    if (!srcKey || !base64Data || this.imageDataCache.has(srcKey)) {
      return;
    }
    this.imageDataCache.set(srcKey, `data:image/jpeg;base64,${base64Data}`);
    this.trimImageDataCache();
  }

  getCachedImagePreview(srcKey) {
    if (!srcKey) {
      return "";
    }
    return this.imageDataCache.get(srcKey) || "";
  }

  trimImageDataCache() {
    while (this.imageDataCache.size > this.cacheMaxSize) {
      const oldestKey = this.imageDataCache.keys().next().value;
      this.imageDataCache.delete(oldestKey);
    }
  }

  shouldRespectFailureCooldown(srcKey) {
    const cooldownUntil = this.failedDetectionCooldowns.get(srcKey);
    if (!cooldownUntil) {
      return false;
    }
    if (Date.now() >= cooldownUntil) {
      this.failedDetectionCooldowns.delete(srcKey);
      return false;
    }
    return true;
  }

  scheduleFailureCooldown(srcKey) {
    if (!srcKey) {
      return;
    }
    this.failedDetectionCooldowns.set(
      srcKey,
      Date.now() + this.detectionRetryDelayMs
    );
  }

  findClosestImage(el) {
    if (!el) {
      return null;
    }

    if (el.tagName === "IMG") {
      return el;
    }

    // Use native closest to find ancestor IMG
    const anc = el.closest && el.closest("img");
    if (anc) return anc;

    // Support <picture> wrappers
    if (el.tagName === "PICTURE") {
      const img = el.querySelector("img");
      if (img) return img;
    }

    // Walk up a few levels to catch common wrappers
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 5) {
      if (node.tagName === "IMG") return node;
      const imgChild = node.querySelector && node.querySelector(":scope > img");
      if (imgChild) return imgChild;
      node = node.parentElement;
      depth++;
    }

    return null;
  }

  // Try to find an element (starting from `el`) that has a usable CSS background-image
  findElementWithBackgroundImage(el) {
    let node = el;
    let depth = 0;

    while (node && depth < 5) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const style = window.getComputedStyle(node);
        const bgImage = style && style.backgroundImage;
        if (bgImage && bgImage !== "none") {
          const urlMatch = bgImage.match(/url\(("|')?(.*?)("|')?\)/i);
          const url = urlMatch && urlMatch[2] ? urlMatch[2].trim() : "";
          if (url) {
            // Tag the node so getImageSourceKey and caching can use this value
            node.__imageAIHoverSrc = url;
            return node;
          }
        }
      }
      node = node.parentElement;
      depth += 1;
    }

    return null;
  }

  findClosestImageFromPoint(x, y, radius) {
    // Get all images on the page
    const images = document.querySelectorAll("img");
    let closestImg = null;
    let closestDistance = radius;

    images.forEach((img) => {
      const rect = img.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.sqrt(
        Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
      );

      if (distance < closestDistance) {
        closestDistance = distance;
        closestImg = img;
      }
    });

    return closestImg;
  }

  imageToBase64(img) {
    return new Promise((resolve, reject) => {
      const srcKey = this.getImageSourceKey(img);
      if (!srcKey) {
        resolve("");
        return;
      }

      // When the target is not a real <img>, create a temporary Image element
      let imageEl = img instanceof HTMLImageElement ? img : null;
      if (!imageEl) {
        imageEl = new Image();
        imageEl.crossOrigin = "anonymous";
        imageEl.src = srcKey;
      }

      // Handle data URLs directly
      if (srcKey.startsWith("data:")) {
        resolve(srcKey.split(",")[1]);
        return;
      }

      // Handle blob URLs
      if (srcKey.startsWith("blob:")) {
        fetch(srcKey)
          .then((response) => response.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onload = () => {
              const base64Data = reader.result.split(",")[1];
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
          .catch(reject);
        return;
      }

      // For external URLs, try to use canvas with the already loaded image
      // This may fail with SecurityError for cross-origin images
      if (imageEl.complete && imageEl.naturalWidth > 0) {
        // Image is already loaded, try canvas conversion
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          canvas.width = imageEl.naturalWidth;
          canvas.height = imageEl.naturalHeight;

          ctx.drawImage(imageEl, 0, 0);

          canvas.toBlob(
            (blob) => {
              const reader = new FileReader();
              reader.onload = () => {
                const base64Data = reader.result.split(",")[1];
                resolve(base64Data);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            },
            "image/jpeg",
            0.8
          );
        } catch (error) {
          // Handle SecurityError and other canvas-related errors
          if (
            error.name === "SecurityError" ||
            error.message.includes("Tainted canvases")
          ) {
            console.log(
              "Cross-origin image detected, cannot convert to base64:",
              this.getImageSourceKey(img)
            );
            resolve(null); // Return null to indicate we can't process this image
          } else {
            reject(error);
          }
        }
      } else {
        // Image not yet loaded, wait for it to load then try canvas
        imageEl.addEventListener(
          "load",
          () => {
            try {
              const canvas = document.createElement("canvas");
              const ctx = canvas.getContext("2d");

              canvas.width = imageEl.naturalWidth;
              canvas.height = imageEl.naturalHeight;

              ctx.drawImage(imageEl, 0, 0);

              canvas.toBlob(
                (blob) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64Data = reader.result.split(",")[1];
                    resolve(base64Data);
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                },
                "image/jpeg",
                0.8
              );
            } catch (error) {
              // Handle SecurityError and other canvas-related errors
              if (
                error.name === "SecurityError" ||
                error.message.includes("Tainted canvases")
              ) {
                console.log(
                  "Cross-origin image detected, cannot convert to base64:",
                  img.src
                );
                resolve(null); // Return null to indicate we can't process this image
              } else {
                reject(error);
              }
            }
          },
          { once: true }
        );

        imageEl.addEventListener(
          "error",
          () => {
            reject(new Error("Image failed to load"));
          },
          { once: true }
        );
      }
    });
  }

  async detectImage(base64Image, imgSrc = "") {
    try {
      // Create cache key from image source or base64 data
      const cacheKey = imgSrc || base64Image.substring(0, 200);

      // Check cache first
      if (this.detectionCache.has(cacheKey)) {
        return this.detectionCache.get(cacheKey);
      }

      const response = await fetch(this.parent.settings.detectionEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: base64Image }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const result = await response.json();

      // Cache the result (manage cache size)
      this.detectionCache.set(cacheKey, result);
      if (this.detectionCache.size > this.cacheMaxSize) {
        const firstKey = this.detectionCache.keys().next().value;
        this.detectionCache.delete(firstKey);
      }

      return result;
    } catch (error) {
      console.log("Detection API error:", error);
      return null;
    }
  }

  async detectImageByUrl(imgSrc) {
    try {
      if (!imgSrc) {
        return null;
      }

      const cacheKey = imgSrc;
      if (this.detectionCache.has(cacheKey)) {
        return this.detectionCache.get(cacheKey);
      }

      const urlEndpoint = this.parent.settings.detectionEndpoint.replace(
        "/api/detect-base64",
        "/api/detect-url"
      );

      const response = await fetch(urlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: imgSrc }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const result = await response.json();

      this.detectionCache.set(cacheKey, result);
      if (this.detectionCache.size > this.cacheMaxSize) {
        const firstKey = this.detectionCache.keys().next().value;
        this.detectionCache.delete(firstKey);
      }

      return result;
    } catch (error) {
      console.log("URL Detection API error:", error);
      return null;
    }
  }

  async startDetectionForCurrentImage() {
    let srcKey = "";
    try {
      // Debounce: avoid concurrent detections
      if (this.isProcessing) return;
      if (!this.parent.hoveredImage) return;

      srcKey = this.getImageSourceKey(this.parent.hoveredImage);
      if (!srcKey) return;

      // Respect recent failure cooldowns to avoid hammering the backend
      if (this.shouldRespectFailureCooldown(srcKey)) {
        return;
      }

      // If we already have valid cached detections, just show them
      const cached = this.detectionCache.get(srcKey);
      if (this.hasValidDetections(cached)) {
        this.parent.showOverlay(cached);
        return;
      }

      this.isProcessing = true;

      // Try to get a base64 representation first (fast path for same-origin / data / blob)
      const base64Payload = await this.getOrBuildBase64ForImage(
        this.parent.hoveredImage
      );

      let detectionResult = null;

      if (base64Payload === null) {
        // Explicit null from imageToBase64 means cross-origin / tainted canvas
        detectionResult = await this.detectImageByUrl(srcKey);
      } else if (base64Payload) {
        // Non-empty base64 payload: use the base64 detection endpoint
        detectionResult = await this.detectImage(base64Payload, srcKey);
      } else {
        // Empty string (no data) and not explicitly null - nothing to do
        return;
      }

      // Cache and show results if we have any
      if (this.hasValidDetections(detectionResult)) {
        this.detectionCache.set(srcKey, detectionResult);
        this.parent.showOverlay(detectionResult);
      } else {
        // Mark recent failure to avoid re-querying immediately
        this.scheduleFailureCooldown(srcKey);
        // Show thumbnail / no-detection state
        this.parent.showOverlay(null);
      }
    } catch (e) {
      console.log("startDetectionForCurrentImage error:", e);
      if (srcKey) {
        this.scheduleFailureCooldown(srcKey);
      }
      // Fall back to simple thumbnail / indicator overlay
      this.parent.showOverlay(null);
    } finally {
      this.isProcessing = false;
    }
  }

  // Helper function to check if detection results have actual detections
  hasValidDetections(detectionResult) {
    return (
      detectionResult &&
      detectionResult.data &&
      Array.isArray(detectionResult.data) &&
      detectionResult.data.length > 0
    );
  }

  updateImageCanvasPosition() {
    if (!this.parent.hoveredImage || !this.imageCanvasOverlay) return;

    const rect = this.parent.hoveredImage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Update canvas position and size to match image
    this.imageCanvasOverlay.style.left = rect.left + "px";
    this.imageCanvasOverlay.style.top = rect.top + "px";
    this.imageCanvasOverlay.style.width = rect.width + "px";
    this.imageCanvasOverlay.style.height = rect.height + "px";
    this.imageCanvasOverlay.width = rect.width;
    this.imageCanvasOverlay.height = rect.height;

    // Redraw the detection boxes (they need to be scaled to new size)
    this.redrawImageCanvasOverlay();
  }

  redrawImageCanvasOverlay() {
    if (!this.imageCanvasOverlay || !this.parent.hoveredImage) return;

    const rect = this.parent.hoveredImage.getBoundingClientRect();
    const ctx = this.imageCanvasOverlay.getContext("2d");
    ctx.clearRect(
      0,
      0,
      this.imageCanvasOverlay.width,
      this.imageCanvasOverlay.height
    );

    // Get the cached detection result for this image
    const cacheKey = this.getImageSourceKey(this.parent.hoveredImage) || "";
    if (this.detectionCache.has(cacheKey)) {
      const detectionResult = this.detectionCache.get(cacheKey);

      detectionResult.data.forEach((obj) => {
        const x = (obj.x / 100) * rect.width;
        const y = (obj.y / 100) * rect.height;
        const width = (obj.width / 100) * rect.width;
        const height = (obj.height / 100) * rect.height;

        // Draw bounding box
        ctx.strokeStyle = obj.color || "#00FF00";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);

        // Draw label
        if (obj.confidence) {
          ctx.fillStyle = obj.color || "#00FF00";
          ctx.font = "14px Arial";
          ctx.fillText(
            `${obj.type} ${(obj.confidence * 100).toFixed(0)}%`,
            x,
            y - 5
          );
        }
      });
    }
  }

  showImageCanvasOverlay(img, detectionResult) {
    // Remove any existing canvas overlay
    this.removeImageCanvasOverlay();

    if (
      !img ||
      !detectionResult ||
      !detectionResult.data ||
      detectionResult.data.length === 0
    ) {
      return;
    }

    // Cache the detection result using image source as key
    const cacheKey =
      this.getImageSourceKey(img) || detectionResult.imageHash || "";
    this.detectionCache.set(cacheKey, detectionResult);

    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Create canvas overlay positioned over the image
    const canvas = document.createElement("canvas");
    canvas.className = "detection-canvas";
    canvas.style.position = "fixed";
    canvas.style.left = rect.left + "px";
    canvas.style.top = rect.top + "px";
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.style.zIndex = "999998"; // Just below the popup
    canvas.style.pointerEvents = "none";
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Draw bounding boxes
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    detectionResult.data.forEach((obj) => {
      const x = (obj.x / 100) * rect.width;
      const y = (obj.y / 100) * rect.height;
      const width = (obj.width / 100) * rect.width;
      const height = (obj.height / 100) * rect.height;

      // Draw bounding box
      ctx.strokeStyle = obj.color || "#00FF00";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      // Draw label
      if (obj.confidence) {
        ctx.fillStyle = obj.color || "#00FF00";
        ctx.font = "14px Arial";
        ctx.fillText(
          `${obj.type} ${(obj.confidence * 100).toFixed(0)}%`,
          x,
          y - 5
        );
      }
    });

    // Store reference for cleanup
    this.imageCanvasOverlay = canvas;
    document.body.appendChild(canvas);
  }

  removeImageCanvasOverlay() {
    if (this.imageCanvasOverlay) {
      document.body.removeChild(this.imageCanvasOverlay);
      this.imageCanvasOverlay = null;
    }
  }

  ensureCrawlingCanvas() {
    if (this.crawlingCanvas) return;
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "999997";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    this.crawlingCanvas = canvas;
    this.crawlingCtx = canvas.getContext("2d");
    document.body.appendChild(canvas);
  }

  startCrawlingAnimation() {
    if (!this.parent.isActive) return;
    this.ensureCrawlingCanvas();
    if (this.crawlingAnimRaf) return;
    if (!this.parent.settings.showCrawlingLines) {
      this.stopCrawlingAnimation();
      return;
    }
    const step = () => {
      this.drawCrawlingFrame();
      this.crawlingAnimRaf = requestAnimationFrame(step);
    };
    this.crawlingAnimRaf = requestAnimationFrame(step);
  }

  stopCrawlingAnimation() {
    if (this.crawlingAnimRaf) {
      cancelAnimationFrame(this.crawlingAnimRaf);
      this.crawlingAnimRaf = 0;
    }
    if (this.crawlingCtx && this.crawlingCanvas) {
      this.crawlingCtx.clearRect(
        0,
        0,
        this.crawlingCanvas.width,
        this.crawlingCanvas.height
      );
    }
  }

  drawCrawlingFrame() {
    if (!this.crawlingCtx || !this.crawlingCanvas) return;
    if (!this.parent.settings.showCrawlingLines) {
      this.stopCrawlingAnimation();
      return;
    }
    const ctx = this.crawlingCtx;
    const canvas = this.crawlingCanvas;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.parent.isActive) return;
    const src = this.parent.hoveredImage
      ? this.parent.hoveredImage.src || ""
      : "";
    const result = src && this.detectionCache.get(src);
    if (!this.hasValidDetections(result) || !this.parent.hoveredImage) return;
    const rect = this.parent.hoveredImage.getBoundingClientRect();
    const mx = this.parent.mousePosition.x;
    const my = this.parent.mousePosition.y;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    this.crawlingDashOffset = (this.crawlingDashOffset - 1) % 10000;
    ctx.lineDashOffset = this.crawlingDashOffset;
    result.data.forEach((obj, idx) => {
      const left = rect.left + (obj.x / 100) * rect.width;
      const top = rect.top + (obj.y / 100) * rect.height;
      const right = left + (obj.width / 100) * rect.width;
      const bottom = top + (obj.height / 100) * rect.height;

      const corners = [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ];

      corners.forEach((pt, cIdx) => {
        const [x, y] = pt;
        const grad = ctx.createLinearGradient(x, y, mx, my);
        grad.addColorStop(0, "rgba(0,229,255,0.9)");
        grad.addColorStop(1, "rgba(0,229,255,0.2)");
        ctx.strokeStyle = grad;
        ctx.shadowColor = "rgba(0,229,255,0.6)";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(mx, my);
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }

  clearCaches() {
    // Clear detection cache to free memory
    this.detectionCache.clear();
  }
}
