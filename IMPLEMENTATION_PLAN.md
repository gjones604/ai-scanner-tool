---
description: Refactor Chrome Extension to React and Implement Cyberpunk Scanner Features
---

# Cyberpunk 2077 Scanner & React Refactor Plan

This workflow outlines the steps to refactor the existing vanilla JS Chrome extension into a modern React application and implement advanced "Scanner" features using local AI.

## Phase 1: React Infrastructure Setup
The goal is to move from ad-hoc JS files to a structured build system that supports React components, HMR (Hot Module Replacement) during dev, and optimized builds for Chrome.

1.  **Initialize React Extension Project**
    - Create `extension-react` directory.
    - Initialize Vite with React + TypeScript.
    - Install `crxjs/vite-plugin` (or compatible alternative) to handle manifest generation and HMR.
    - Setup TailwindCSS for rapid "Cyberpunk" styling (gradients, neon glows).

2.  **Migrate Key Logic to Hooks/Context**
    - Port `ImageScanner` logic (canvas crawling, YOLO interfacing) to a custom hook `useImageScanner`.
    - Port `ImageHoverMenu` to a React Component `<ScannerHUD />`.
    - Create a global `ScannerContext` to manage state (Active, Idle, Scanning, Analyzing).

## Phase 2: Cyberpunk Scanner UX Implementation
Create a visually immersive "Netrunner" interface.

1.  **The Scanner Overlay (`<ScannerOverlay />`)**
    - A full-screen, transparent layer (pointer-events-none usually, but active when interacting).
    - **Visuals**: Hexagonal grid background (low opacity), scanlines, vignette.
    - **Reticles**: Instead of simple boxes, draw "bracket" corners around detected objects with floating data labels connecting via leader lines.

2.  **The Data Shard (Summary UI)**
    - Replace the simple text summary popup with a "Shard" UI.
    - An animated side-panel or floating window that looks like a holographic projection.
    - Streaming text support (typewriter effect).

3.  **Interaction Design**
    - **Sound**: Add subtle SFX for activation ("power up") and detection ("lock on"). *User can disable*.
    - **Keyboard Control**: WASD or Vim keys to "tab" between detected objects without using the mouse.

## Phase 3: Advanced Local AI Integration (Ollama/LM Studio)
Enhance the intelligence of the scanner.

1.  **Backend Upgrade (`server.py`)**
    - Add a general-purpose `/api/chat` endpoint that proxies to Ollama/LM Studio.
    - Implement a "System Router" that decides if a user query needs:
        - Vision (YOLO)
        - Text Analysis (LLM)
        - Browser Action (Tool Call)

2.  **Tool Calling & Entity Analysis**
    - When hovering text/names, the user can press a key to "Scan Entity".
    - The LLM receives the text context and can call a "search" tool (mocked or real) or just provide deep context from its training data.
    - Display this info in the "Data Shard".

## Phase 4: Performance Optimization
- **Optimistic UI**: Show "Scanning..." visual immediately while waiting for Python backend.
- **Deduplication**: Ensure we don't re-scan the same image repeatedly (already in place, but verify for React).
- **GPU Usage**: Ensure YOLO model stays loaded; consider using `yolo11n` (nano) by default for speed, togglable to `x` (extra large) for accuracy.

## Execution Steps for User
1. Run the "Refactor to React" workflow (I will create this).
2. Start the Python server.
3. Load the new `dist` folder extension in Chrome.
