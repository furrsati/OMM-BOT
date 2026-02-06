/**
 * Centralized API configuration for the dashboard.
 *
 * All dashboard pages should import API_URL from this module
 * instead of defining it locally. This prevents inconsistencies
 * and makes it easier to manage API endpoints.
 */

// Client-side API URL (relative path for same-origin requests)
// This routes through Next.js API routes which proxy to the backend
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// Backend API URL (for server-side API routes to proxy requests)
// This is the actual backend server running the bot
export const BOT_API_URL = process.env.BOT_API_URL || 'https://omm-bot.onrender.com';

// Default timeout for API requests (in milliseconds)
export const API_TIMEOUT = 10000;
export const CRITICAL_API_TIMEOUT = 60000; // For operations like kill switch

/**
 * Fetch from the bot backend with consistent error handling
 */
export async function fetchFromBackend(
  path: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = API_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${BOT_API_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Helper to create a backend unavailable response
 */
export function backendUnavailableResponse(message?: string) {
  return {
    success: false,
    error: message || 'Backend unavailable',
    code: 'BACKEND_UNAVAILABLE',
    backendUrl: BOT_API_URL,
  };
}

/**
 * Check if an error is a connection/timeout error
 */
export function isConnectionError(error: any): boolean {
  return (
    error.name === 'AbortError' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.message?.includes('fetch failed')
  );
}
