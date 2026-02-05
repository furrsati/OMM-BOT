# OURMM Dashboard

Admin dashboard for monitoring the OURMM meme coin trading bot.

## Quick Start

### 1. Install Dependencies
```bash
cd interface/memecoin-dashboard
npm install
```

### 2. Configure Environment
Create `.env.local` in the dashboard directory:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

For production:
```bash
NEXT_PUBLIC_API_URL=https://your-backend-url.com/api
```

### 3. Run Development Server
```bash
npm run dev
```
Dashboard will be available at: **http://localhost:3000**

### 4. Build for Production
```bash
npm run build
npm start
```

## Running Both Backend + Dashboard

### Terminal 1 - Backend:
```bash
cd OURMM
npm run dev
```

### Terminal 2 - Dashboard:
```bash
cd OURMM/interface/memecoin-dashboard
npm run dev
```

## Deployment to Render

### Option 1: Deploy from Root (Monorepo)
1. In Render dashboard, create a new **Web Service**
2. Connect your GitHub repository (OURMM)
3. Configure build settings:
   - **Root Directory**: `interface/memecoin-dashboard`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your backend API URL

### Option 2: Deploy Using Render Blueprint
Create `render.yaml` in your repo root:
```yaml
services:
  - type: web
    name: ourmm-backend
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false

  - type: web
    name: ourmm-dashboard
    runtime: node
    rootDir: interface/memecoin-dashboard
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NEXT_PUBLIC_API_URL
        value: https://ourmm-backend.onrender.com/api
```

## Features

✅ Real-time system status monitoring
✅ Active trades tracking
✅ P&L visualization
✅ Win rate statistics
✅ Auto-refresh every 5 seconds

## Tech Stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **React 19**

## Troubleshooting

### Build Error: "Cannot find module '@tailwindcss/postcss'"
This is already fixed in the current setup. The package.json includes `@tailwindcss/postcss` v4.

### Dashboard shows "Connection Error"
- Make sure the backend is running
- Check that `NEXT_PUBLIC_API_URL` is set correctly
- Verify the backend has CORS enabled for the dashboard URL

### Port 3000 already in use
The dashboard runs on port 3000 by default. If your backend also uses 3000, change the dashboard port:
```bash
npm run dev -- -p 3001
```

Then access at: http://localhost:3001
