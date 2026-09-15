import browser from "webextension-polyfill";

class AuditLogger {
  constructor() {
    this.buffer = [];
    this.flushInterval = null;
    this.isFlushing = false;
    this.seenLogs = new Set();
  }

  start() {
    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => this.flush(), 2000);
    }
  }

  stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  /**
   * Log an event to the audit trail
   * @param {string} eventName - PII_DETECTED, PRIVACY_GATE_BLOCKED, SERVER_REQUEST_SENT, etc.
   * @param {Object} details - Additional structured data
   */
  log(eventName, details = {}) {
    if (eventName === "PII_DETECTED") {
      const payloadStr = JSON.stringify({ event: eventName, ...details });
      if (this.seenLogs.has(payloadStr)) return;
      this.seenLogs.add(payloadStr);
    }

    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      event: eventName,
      ...details
    };
    
    this.buffer.push(entry);
    
    // Broadcast immediately to active UI (e.g. dashboard sidepanel)
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.sendMessage({
        type: "AUDIT_EVENT",
        payload: entry
      }).catch(() => {
        // Ignore if no listeners (UI closed)
      });
    }

    if (this.buffer.length > 50) {
      this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0 || this.isFlushing) return;
    this.isFlushing = true;
    let toFlush = [];

    try {
      toFlush = [...this.buffer];
      this.buffer = [];
      
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        const data = await browser.storage.local.get("auditLogs");
        const logs = data.auditLogs || [];
        
        // Keep only last 1000 logs to prevent storage bloat
        const newLogs = [...toFlush, ...logs].slice(0, 1000);
        
        await browser.storage.local.set({ auditLogs: newLogs });
      } else {
        // In Node benchmark environments, just clear the buffer
      }
    } catch (err) {
      console.error("[AuditLogger] Failed to flush logs", err);
      // Put them back if we failed
      this.buffer.unshift(...toFlush); 
    } finally {
      this.isFlushing = false;
    }
  }

  async getLogs() {
    await this.flush();
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      const data = await browser.storage.local.get("auditLogs");
      return data.auditLogs || [];
    }
    return [];
  }
  
  async clearLogs() {
    this.buffer = [];
    this.seenLogs.clear();
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      await browser.storage.local.set({ auditLogs: [] });
    }
  }
}

export const auditLogger = new AuditLogger();
auditLogger.start();
