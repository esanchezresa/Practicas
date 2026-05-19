import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Cesium resolves workers/assets from this base path.
// Use a stable absolute URL so dev/prod do not depend on Angular asset rewriting.
(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = new URL(
  'https://cesium.com/downloads/cesiumjs/releases/1.140/Build/Cesium/',
).toString();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
