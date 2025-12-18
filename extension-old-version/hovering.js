class ImageHoverMenu {
  constructor() {
    this.isActive = false;
    this.currentImage = null;
    this.selectedIndex = 0;
    this.options = [
      "Reverse image search",
      "Google search for detected objects",
      "Save image",
      "Copy image URL",
    ];
    this.overlay = null;
    this.menuItems = [];
    this._positionRaf = 0; // For throttling position updates
    this.init();
  }

  init() {
    this.createOverlay();
    this.setupEventListeners();
  }

  createOverlay() {
    this.overlay = document.createElement("div");
    this.overlay.id = "image-hover-menu";
    this.overlay.style.position = "fixed";
    this.overlay.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
    this.overlay.style.borderRadius = "8px";
    this.overlay.style.padding = "10px";
    this.overlay.style.zIndex = "1000001"; // Higher than content.js overlay (999999)
    this.overlay.style.display = "none";
    this.overlay.style.minWidth = "200px";
    this.overlay.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
    this.overlay.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    this.overlay.style.backdropFilter = "blur(10px)";
    this.overlay.style.fontFamily = "Arial, sans-serif";
    this.overlay.style.fontSize = "14px";
    this.overlay.style.color = "white";

    document.body.appendChild(this.overlay);
  }

  setupEventListeners() {
    // Mouse wheel for selection
    document.addEventListener("wheel", this.handleWheel.bind(this), {
      passive: false,
    });

    // Left click to select
    document.addEventListener("click", this.handleClick.bind(this));

    // Prevent context menu on right click when active
    document.addEventListener("contextmenu", this.handleContextMenu.bind(this));

    // Track mouse movement to update menu position
    document.addEventListener("mousemove", this.handleMouseMove.bind(this));
  }

  handleWheel(event) {
    if (!this.isActive || !this.currentImage) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.deltaY > 0) {
      // Scroll down - next option
      this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
    } else {
      // Scroll up - previous option
      this.selectedIndex =
        (this.selectedIndex - 1 + this.options.length) % this.options.length;
    }

    this.updateMenuDisplay();
  }

  handleClick(event) {
    if (!this.isActive || !this.currentImage) return;

    // Left click anywhere to make selection
    if (event.button === 0) {
      // Left click
      event.preventDefault();
      event.stopPropagation();

      this.selectCurrentOption();
    }
  }

  handleContextMenu(event) {
    if (this.isActive && this.currentImage) {
      event.preventDefault();
    }
  }

  handleMouseMove(event) {
    if (!this.isActive || !this.currentImage) return;

    // Throttle position updates for performance
    if (!this._positionRaf) {
      this._positionRaf = requestAnimationFrame(() => {
        this.positionMenu(event.clientX, event.clientY);
        this._positionRaf = 0;
      });
    }
  }

  showMenu(imageElement, x, y, detectionResult = null) {
    this.isActive = true;
    this.currentImage = imageElement;
    this.selectedIndex = 0;

    // Check if we have valid detection results
    if (detectionResult && this.hasValidDetections(detectionResult)) {
      // Show context menu with detection results
      this.updateMenuDisplay();
      this.positionMenu(x, y);
      this.overlay.style.display = "block";
    } else {
      // Show simple "no detection" message instead of context menu
      this.showNoDetectionMessage(x, y);
    }
  }

  // Helper function to check if detection results have actual detections
  hasValidDetections(detectionResult) {
    return detectionResult &&
           detectionResult.data &&
           Array.isArray(detectionResult.data) &&
           detectionResult.data.length > 0;
  }

  showNoDetectionMessage(x, y) {
    // Clear any existing content
    this.overlay.innerHTML = "";

    // Create simple message
    const message = document.createElement("div");
    message.textContent = "no detections found on image";
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

    this.overlay.appendChild(message);

    // Position and show the message
    this.positionMenu(x, y);
    this.overlay.style.display = "block";
  }

  updateMenuDisplay() {
    this.overlay.innerHTML = "";

    this.options.forEach((option, index) => {
      const item = document.createElement("div");
      item.textContent = option;
      item.style.padding = "8px 12px";
      item.style.cursor = "pointer";
      item.style.borderRadius = "4px";
      item.style.marginBottom = "2px";
      item.style.transition = "all 0.2s ease";
      item.style.userSelect = "none";

      if (index === this.selectedIndex) {
        item.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
        item.style.transform = "scale(1.05)";
        item.style.fontWeight = "bold";
      } else {
        item.style.backgroundColor = "transparent";
        item.style.opacity = "0.7";
      }

      item.addEventListener("mouseenter", () => {
        this.selectedIndex = index;
        this.updateMenuDisplay();
      });

      this.menuItems.push(item);
      this.overlay.appendChild(item);
    });

    // Add instructions
    const instructions = document.createElement("div");
    instructions.style.marginTop = "8px";
    instructions.style.paddingTop = "8px";
    instructions.style.borderTop = "1px solid rgba(255, 255, 255, 0.2)";
    instructions.style.fontSize = "12px";
    instructions.style.opacity = "0.6";
    instructions.style.textAlign = "center";
    instructions.innerHTML = "🖱️ Scroll: Navigate<br>🖱️ Click: Select";

    this.overlay.appendChild(instructions);
  }

  positionMenu(x, y) {
    const menuRect = this.overlay.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x + 10;
    let top = y - 10;

    // Adjust if menu would go off screen
    if (left + menuRect.width > viewportWidth) {
      left = x - menuRect.width - 10;
    }

    if (top + menuRect.height > viewportHeight) {
      top = y - menuRect.height + 10;
    }

    if (top < 0) {
      top = 10;
    }

    if (left < 0) {
      left = 10;
    }

    this.overlay.style.left = left + "px";
    this.overlay.style.top = top + "px";
  }

  selectCurrentOption() {
    const selectedOption = this.options[this.selectedIndex];
    console.log(
      "Selected:",
      selectedOption,
      "for image:",
      this.currentImage.src || this.currentImage
    );

    // TODO: Implement actual functionality for each option
    // For now, just log the selection
    switch (selectedOption) {
      case "Reverse image search":
        console.log("Reverse image search");
        break;
      case "Google search for detected objects":
        console.log("Google search for detected objects");
        break;
      case "Save image":
        console.log("Save image");
        break;
      case "Copy image URL":
        console.log("Copy image URL");
        break;
      default:
        console.log("Unknown option selected:", selectedOption);
    }

    // Hide menu after selection
    this.hideMenu();
  }

  // Public method to check if menu is active
  getIsActive() {
    return this.isActive;
  }

  getCurrentImage() {
    return this.currentImage;
  }

  // Public method to hide the menu
  hideMenu() {
    this.isActive = false;
    this.currentImage = null;
    this.selectedIndex = 0;
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }
}

// Export for use in content.js
window.ImageHoverMenu = ImageHoverMenu;
