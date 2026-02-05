# 🚀 Render Deployment Guide

## Prerequisites

Before deploying to Render, ensure you have:
- A [Render account](https://render.com)
- A PostgreSQL database (Render provides free PostgreSQL instances)
- Your Solana RPC endpoint (e.g., Helius, QuickNode, or Triton)

## Step 1: Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **PostgreSQL**
3. Fill in:
   - **Name**: `memecoin-bot-db` (or your preferred name)
   - **Database**: `memecoin_bot`
   - **User**: `memecoin_bot_user`
   - **Region**: Choose closest to your target audience
   - **Plan**: Free (or paid for production)
4. Click **Create Database**
5. Wait for database to be provisioned
6. Copy the **Internal Database URL** (starts with `postgresql://`)

## Step 2: Create Web Service

1. In Render Dashboard, click **New** → **Web Service**
2. Connect your GitHub repository
3. Fill in:
   - **Name**: `memecoin-trading-bot`
   - **Region**: Same as your database
   - **Branch**: `main`
   - **Root Directory**: Leave blank
   - **Runtime**: Node
   - **Build Command**: `npm install --include=dev && npm run build`
   - **Start Command**: `node dist/index.js`
   - **Plan**: Free or Starter (Starter recommended for production)

## Step 3: Configure Environment Variables

In the **Environment** section of your web service, add the following variables:

### ✅ Required Variables

| Variable | Value | Example | Where to get |
|----------|-------|---------|--------------|
| `DATABASE_URL` | Your PostgreSQL connection string | `postgresql://user:pass@host/db` | From Step 1 - use **Internal Database URL** |
| `SOLANA_RPC_PRIMARY` | Your primary Solana RPC endpoint | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` | [Helius](https://helius.dev), [QuickNode](https://quicknode.com), or [Triton](https://triton.one) |
| `NODE_ENV` | Set to `production` | `production` | - |

### ⚙️ Optional but Recommended

| Variable | Default | Recommended | Description |
|----------|---------|-------------|-------------|
| `SOLANA_RPC_SECONDARY` | None | Your backup RPC | Failover endpoint |
| `SOLANA_RPC_TERTIARY` | None | Your tertiary RPC | Second failover |
| `API_PORT` | 3001 | 10000 | Render uses port 10000 by default |
| `LOG_LEVEL` | info | info | Log verbosity (debug/info/warn/error) |

### 🔐 Trading Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_TRADING` | false | Set to `true` to enable real trades |
| `PAPER_TRADING_MODE` | true | Set to `false` for real trading |
| `WALLET_PRIVATE_KEY` | None | **Required for trading** - Base58 encoded private key |
| `MAX_POSITION_SIZE_PERCENT` | 5 | Maximum % of wallet per trade |
| `MAX_DAILY_LOSS_PERCENT` | 8 | Stop trading if daily loss exceeds this |
| `MAX_DAILY_PROFIT_PERCENT` | 15 | Stop new entries if daily profit exceeds this |

### 📊 Monitoring & Alerts (Optional)

| Variable | Required? | Where to get |
|----------|-----------|--------------|
| `TELEGRAM_BOT_TOKEN` | No | [@BotFather](https://t.me/botfather) on Telegram |
| `TELEGRAM_ALERT_CHAT_ID` | No | Send a message to your bot, then visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` |
| `DISCORD_WEBHOOK_URL` | No | Discord Server Settings → Integrations → Webhooks |

### 🔑 API Keys (Optional)

| Variable | Purpose | Where to get |
|----------|---------|--------------|
| `BIRDEYE_API_KEY` | Token price data | [Birdeye](https://birdeye.so) |
| `COINGECKO_API_KEY` | Market data | [CoinGecko](https://www.coingecko.com/en/api) |

## Step 4: Deploy

1. Click **Create Web Service**
2. Render will automatically:
   - Clone your repository
   - Install dependencies
   - Build the TypeScript code
   - Start the bot

## Step 5: Monitor Deployment

### View Logs

1. Go to your web service in Render Dashboard
2. Click **Logs** tab
3. You should see:
   ```
   🤖 Starting Solana Memecoin Trading Bot V3.0
   🧠 WITH ADAPTIVE LEARNING ENGINE
   ✅ Environment variables validated
   🗄️  Initializing PostgreSQL...
   ✅ PostgreSQL connected
   ...
   🚀 ALL SYSTEMS OPERATIONAL
   ```

### Check Health

Your bot exposes health endpoints:
- Health check: `https://your-app.onrender.com/health`
- API status: `https://your-app.onrender.com/api/status`

## Troubleshooting

### ❌ "Missing required environment variable"

**Problem**: Bot exits immediately with missing env var message.

**Solution**:
1. Go to Render Dashboard → Your Service → Environment
2. Add the missing variable(s)
3. Save changes (Render will auto-redeploy)

### ❌ "DATABASE CONNECTION FAILED"

**Problem**: Can't connect to PostgreSQL.

**Solutions**:
1. **Wrong URL**: Ensure you copied the **Internal Database URL** from Render
2. **Database not ready**: Wait 2-3 minutes after creating the database
3. **SSL issue**: Our code automatically handles Render's SSL requirement
4. **Format**: Must be `postgresql://user:password@host:port/database`

### ❌ "SOLANA_RPC_PRIMARY connection failed"

**Problem**: Can't connect to Solana RPC.

**Solutions**:
1. Verify your RPC endpoint is working: `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' YOUR_RPC_URL`
2. Check if you need an API key in the URL
3. Try a free RPC temporarily: `https://api.mainnet-beta.solana.com`

### ❌ "Exited with status 1" (no error message)

**Problem**: This was the original issue - now fixed!

**Solution**: The latest code changes ensure all errors are logged to console.

### ⚠️ Bot running but not trading

**Check**:
1. Is `ENABLE_TRADING=true`?
2. Is `PAPER_TRADING_MODE=false`?
3. Is `WALLET_PRIVATE_KEY` set?
4. Check logs for "WALLET NOT LOADED" message

## Production Checklist

Before enabling real trading:

- [ ] PostgreSQL database is production tier (not free)
- [ ] `DATABASE_URL` is correctly set (internal URL for same region)
- [ ] Premium Solana RPC endpoints configured (Helius/QuickNode/Triton)
- [ ] `WALLET_PRIVATE_KEY` is set with a **dedicated trading wallet**
- [ ] Wallet has been funded with SOL for gas fees
- [ ] `ENABLE_TRADING=true` set
- [ ] `PAPER_TRADING_MODE=false` set
- [ ] Telegram or Discord alerts configured
- [ ] Tested in paper trading mode for at least 24 hours
- [ ] Daily loss/profit limits configured appropriately
- [ ] Kill switch enabled (`ENABLE_KILL_SWITCH=true`)

## Security Best Practices

1. **Dedicated Wallet**: Never use your main wallet. Create a new wallet just for the bot.
2. **Limited Funds**: Only keep 10-20% of your trading capital in the bot wallet.
3. **Environment Variables**: Never commit `.env` files or keys to Git.
4. **Private Repository**: Keep your GitHub repository private.
5. **Alerts**: Enable Telegram/Discord to get notified of all trades and errors.
6. **Monitoring**: Check logs regularly, especially in the first 48 hours.

## Cost Estimate (Monthly)

| Service | Free Tier | Production Tier |
|---------|-----------|-----------------|
| Web Service | ✅ Free (750 hrs/mo) | $7/mo (Starter) |
| PostgreSQL | ✅ Free (90 days) | $7/mo (Starter) |
| **Total** | **$0** (first 90 days) | **$14/mo** |

**Note**: Free tier includes:
- Web Service: Spins down after 15 min inactivity (not ideal for trading)
- PostgreSQL: Free for 90 days, then $7/mo

**Recommendation**: For production trading, use paid tiers for 24/7 uptime.

## Need Help?

- Check logs: `Logs` tab in Render Dashboard
- View bot status: `https://your-app.onrender.com/api/status`
- Bot commands: Send `/help` to your Telegram bot (if configured)

## Next Steps

1. Deploy with paper trading mode first
2. Monitor for 24-48 hours
3. Verify all systems operational
4. Fund wallet with small amount
5. Enable real trading
6. Monitor closely for first week
