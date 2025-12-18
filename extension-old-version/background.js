/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  console.log("Image AI Hover extension installed");

  // Set default settings
  chrome.storage.sync.set({
    triggerKey: "Shift",
    detectionEndpoint: "http://localhost:8001/api/detect-base64",
  });
});

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "UPDATE_ICON_STATE") {
    sendResponse?.({ success: true });
    return false;
  }

  if (request?.type === "GET_SETTINGS") {
    chrome.storage.sync.get(["triggerKey", "detectionEndpoint"], (result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  }

  return false;
});
