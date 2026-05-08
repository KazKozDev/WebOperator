import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'WebOperator',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '120',
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7j+P+MslgvKt+KW7D4XERrTI6Kp+wRm0EkR5eR+CGb7yite+vZUza5IjtPOptZgRgcQ9+6hyIx0PsVfrT0aI5JS/gLEgTp4GWOH+jVxys1AvCodZ+H1X/l6obn0IpLkpRw/54cjZxGgXopd+A5xTaGGQaCP2H6AbhTnQ/stlgLSpvwuPS5RyanSZIPcOLEslS79r5CwvX2mMPykeP8EYmJqu3clFo2uc+7EnlaJI0HCYleN0rTTkrI8RMRmSag8JjPLMrul6SfRW2erc19Vb5okVebScYIdkxWrwz4ukeKNRjY1sdv/rayrNIAnFZt0HGgz3JWoW+kuF5/SNLjupswIDAQAB',
  permissions: [
    'activeTab',
    'tabs',
    'scripting',
    'storage',
    'sidePanel',
    'debugger',
    'alarms',
    'nativeMessaging',
    'bookmarks',
    'tabGroups',
  ],
  host_permissions: [
    'http://localhost:11434/*',
    'http://127.0.0.1:11434/*',
    'https://openrouter.ai/*',
    'https://api.deepseek.com/*',
    'http://127.0.0.1:8000/*',
    '<all_urls>',
  ],
  optional_host_permissions: [] as string[],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  action: {
    default_title: 'WebOperator',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  icons: {
    16: 'public/icons/icon16.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
});
