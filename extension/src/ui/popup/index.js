/// <reference types="chrome" />

import browser from "webextension-polyfill";
import "./index.css";

document
  .getElementById("open-panel-btn")
  ?.addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      if (browser.sidePanel) {
        browser.sidePanel.open({ tabId: tab.id });
      }
      window.close();
    }
  });
