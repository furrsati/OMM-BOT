import cors from 'cors';

/**
 * CORS Configuration
 *
 * Allows requests from:
 * - Your dashboard domain (update after deploying)
 * - Localhost for development
 */
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173', // Vite default
  // Add your deployed dashboard URL here after deployment:
  // 'https://your-dashboard.onrender.com',
];

// Allow all origins in development
if (process.env.NODE_ENV === 'development') {
  allowedOrigins.push('*');
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
