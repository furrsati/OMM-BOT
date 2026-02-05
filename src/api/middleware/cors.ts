import cors from 'cors';

/**
 * CORS Configuration
 *
 * Allows requests from:
 * - Dashboard URLs configured via CORS_ALLOWED_ORIGINS env var
 * - Localhost for development
 * - Render.com dashboard URLs
 */

// Build allowed origins list
const buildAllowedOrigins = (): string[] => {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173', // Vite default
  ];

  // Add origins from environment variable (comma-separated)
  // Example: CORS_ALLOWED_ORIGINS=https://dashboard.example.com,https://app.example.com
  if (process.env.CORS_ALLOWED_ORIGINS) {
    const envOrigins = process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim());
    origins.push(...envOrigins);
  }

  // Add specific dashboard URL if provided
  if (process.env.DASHBOARD_URL) {
    origins.push(process.env.DASHBOARD_URL);
  }

  // For Render.com deployments - allow all onrender.com subdomains in production
  // This handles the dynamic URLs Render generates
  return origins;
};

const allowedOrigins = buildAllowedOrigins();

// Check if origin matches allowed patterns
const isOriginAllowed = (origin: string): boolean => {
  // Check exact match first
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Allow any onrender.com subdomain in production
  if (process.env.NODE_ENV === 'production' && origin.endsWith('.onrender.com')) {
    return true;
  }

  return false;
};

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);

    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Check if origin is allowed
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
