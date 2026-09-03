import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest(async (env) => ({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    16: "public/icons/icon16.png",
    48: "public/icons/icon48.png",
    128: "public/icons/icon128.png",
  },
  action: {
    default_icon: {
      16: "public/icons/icon16.png",
      48: "public/icons/icon48.png",
      128: "public/icons/icon128.png",
    },
    default_popup: "src/ui/popup/index.html",
  },
  content_scripts: [
    {
      js: ["src/content/content.js"],
      matches: ["<all_urls>"],
      run_at: "document_idle",
    },
  ],
  background: {
    service_worker: "src/background/service-worker.js",
    type: "module",
  },
  permissions: ["activeTab", "sidePanel", "storage", "tabs"],
  host_permissions: ["<all_urls>"],
  side_panel: {
    default_path: "src/ui/sidepanel/index.html",
  },
  ...(env.mode === "firefox"
    ? {
        sidebar_action: {
          default_panel: "src/ui/sidepanel/index.html",
          default_title: "ShieldBrowse",
        },
        browser_specific_settings: {
          gecko: {
            id: "shieldbrowse@example.com",
            strict_min_version: "109.0",
          },
        },
      }
    : {}),
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  web_accessible_resources: [
    {
      matches: ["<all_urls>"],
      resources: ["models/*", "tesseract/*"],
    },
  ],
}));
