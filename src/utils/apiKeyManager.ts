/**
 * Compatibility facade for older imports.
 *
 * Credentials are intentionally process configuration only. HTTP headers,
 * bearer tokens, and session values are never interpreted as Google keys.
 */
export class ApiKeyManager {
  private static instance: ApiKeyManager;

  private constructor() {}

  public static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) ApiKeyManager.instance = new ApiKeyManager();
    return ApiKeyManager.instance;
  }

  public getApiKey(): string | undefined {
    return process.env.GOOGLE_MAPS_API_KEY;
  }

  public hasApiKey(): boolean {
    return Boolean(this.getApiKey());
  }

  public isValidApiKeyFormat(key: string): boolean {
    return /^[A-Za-z0-9_-]{20,50}$/.test(key);
  }
}
