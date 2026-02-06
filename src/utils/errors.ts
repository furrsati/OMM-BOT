/**
 * Error Utilities
 *
 * Provides safe error message extraction for various error types
 * including Solana RPC errors, network errors, and standard Error objects.
 */

/**
 * Safely extract an error message from any error type.
 * Handles: Error objects, strings, Solana RPC errors, network errors, and objects.
 */
export function getErrorMessage(error: unknown): string {
  // Standard Error object
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown Error';
  }

  // String thrown directly
  if (typeof error === 'string') {
    return error;
  }

  // Object with message or code property (Solana RPC errors, etc.)
  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;

    // Check for message property
    if ('message' in errObj && typeof errObj.message === 'string' && errObj.message) {
      return errObj.message;
    }

    // Check for error property (nested error)
    if ('error' in errObj && typeof errObj.error === 'string' && errObj.error) {
      return errObj.error;
    }

    // Check for Solana-style error with code
    if ('code' in errObj) {
      const code = errObj.code;
      if ('data' in errObj && typeof errObj.data === 'object' && errObj.data) {
        const data = errObj.data as Record<string, unknown>;
        if ('message' in data && typeof data.message === 'string') {
          return `RPC Error ${code}: ${data.message}`;
        }
      }
      return `RPC Error: ${code}`;
    }

    // Check for name property
    if ('name' in errObj && typeof errObj.name === 'string' && errObj.name) {
      return errObj.name;
    }

    // Try JSON.stringify for debugging
    try {
      const jsonStr = JSON.stringify(error);
      if (jsonStr && jsonStr !== '{}') {
        return jsonStr.length > 200 ? jsonStr.slice(0, 200) + '...' : jsonStr;
      }
    } catch {
      // Circular reference or other stringify error
    }

    return 'Unknown object error';
  }

  // Null, undefined, or other
  return 'Unknown error';
}
