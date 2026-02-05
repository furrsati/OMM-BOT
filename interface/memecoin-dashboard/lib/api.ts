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
