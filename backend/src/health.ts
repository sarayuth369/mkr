import { jsonResponse } from './errors';

// Bumped manually per deploy - not tied to package.json semver since this
// Worker deploys independently of the Flutter app's own version number.
export const BACKEND_VERSION = '0.1.0';

export function handleHealth(): Response {
  return jsonResponse({ status: 'ok', timestamp: Date.now() });
}

export function handleVersion(): Response {
  return jsonResponse({ version: BACKEND_VERSION, timestamp: Date.now() });
}
