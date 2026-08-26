import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  action: {
    default_icon: {
      16: 'public/icons/icon16.png',
      48: 'public/icons/icon48.png',
      128: 'public/icons/icon128.png',
    },
    default_popup: 'src/ui/popup/index.html',
  },
  content_scripts: [{
    js: ['src/content/index.js'],
    matches: ['<all_urls>'],
    run_at: 'document_idle',
  }],
  background: {
    service_worker: 'src/background/index.js',
    type: 'module',
  },
  permissions: [
    'activeTab',
    'sidePanel',
    'storage'
  ],
  host_permissions: [
    '<all_urls>'
  ],
  side_panel: {
    default_path: 'src/ui/sidepanel/index.html',
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
})
