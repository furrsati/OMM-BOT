# 🚀 Production Setup Checklist

Complete this checklist when you're ready to deploy the bot to production.

---

## 1. Solana Wallet Setup ⏳

### Install Solana CLI
- **Windows Installer**: https://github.com/solana-labs/solana/releases/latest
- Download: `solana-install-init-x86_64-pc-windows-msvc.exe`
- Run installer, restart terminal

### Generate Bot Wallet
```powershell
solana-keygen new --outfile C:\Users\dunze\bot-wallet.json --no-bip39-passphrase
```
- **CRITICAL**: Write down the seed phrase on paper!
- Store paper in safe place (not on computer)

### Convert to Base58 Format
```powershell
cd c:\Users\dunze\OneDrive\Desktop\OURMM
node scripts\convert-wallet-key.js C:\Users\dunze\bot-wallet.json
```
- Copy the base58 private key shown
- Add to `.env` file:
  ```
  WALLET_PRIVATE_KEY=<your_base58_private_key_here>
  ```

### Fund the Wallet
- Get the public address from the script output
- Send 0.5-1 SOL for testing (more for live trading)
- **Never use your main wallet!**

---

## 2. Telegram Bot Setup ⏳

### Create Bot with BotFather
1. Open Telegram, search for `@BotFather`
2. Send: `/newbot`
3. Name: "My Memecoin Bot" (or your choice)
4. Username: `my_memecoin_bot` (must end with `bot`)
5. Copy the token BotFather gives you

### Get Chat ID
1. Send any message to your new bot
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id":123456789}`
4. Copy the chat ID number

### Add to .env
```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ALERT_CHAT_ID=123456789
```

---

## 3. Premium Solana RPC Providers ⏳

### Primary: Helius (REQUIRED)
- Sign up: https://www.helius.dev/
- Create API key
- **For paper trading**: Developer plan ($29/month)
- **For live trading**: Growth plan ($99/month)
- Copy API key

### Secondary: QuickNode (Optional but Recommended)
- Sign up: https://www.quicknode.com/
- Create Solana mainnet endpoint
- Build plan: $49/month
- Copy endpoint URL

### Tertiary: Triton (Optional)
- Sign up: https://triton.one/
- Free tier available, Pro $10/month
- Copy API key

### Add to .env
```
SOLANA_RPC_PRIMARY=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
SOLANA_RPC_SECONDARY=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_KEY/
SOLANA_RPC_TERTIARY=https://your-api-key.rpc.extrnode.com/YOUR_KEY
```

---

## 4. Environment Variables Configuration ⏳

### Create .env file
Copy `.env.example` to `.env`:
```powershell
copy .env.example .env
```

### Fill in ALL required variables
```env
# Solana RPC (from step 3)
SOLANA_RPC_PRIMARY=...
SOLANA_RPC_SECONDARY=...
SOLANA_RPC_TERTIARY=...

# Bot Wallet (from step 1)
WALLET_PRIVATE_KEY=...

# Database (use local for testing)
DATABASE_URL=postgresql://postgres:password@localhost:5432/memecoin_bot
REDIS_URL=redis://localhost:6379

# API Keys (from step 2)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALERT_CHAT_ID=...

# Discord (optional)
DISCORD_WEBHOOK_URL=

# Trading Parameters
MAX_POSITION_SIZE_PERCENT=5
MAX_DAILY_LOSS_PERCENT=8
MAX_DAILY_PROFIT_PERCENT=15
DEFAULT_STOP_LOSS_PERCENT=25
MAX_OPEN_POSITIONS=5

# Conviction Thresholds
HIGH_CONVICTION_THRESHOLD=85
MEDIUM_CONVICTION_THRESHOLD=70
LOW_CONVICTION_THRESHOLD=50

# Operational Settings
NODE_ENV=development
LOG_LEVEL=info
ENABLE_TRADING=false
PAPER_TRADING_MODE=true

# API Configuration
API_PORT=3001

# Security
ENABLE_KILL_SWITCH=true
```

---

## 5. Database Setup (Local Testing) ⏳

### Start PostgreSQL and Redis
```powershell
docker-compose up -d
```

### Verify databases are running
```powershell
docker-compose ps
```

You should see:
- `memecoin_bot_postgres` - running
- `memecoin_bot_redis` - running

### Test database connection
```powershell
npm run dev
```
Look for:
- ✅ PostgreSQL connected
- ✅ Redis connected

---

## 6. Local Testing ⏳

### Start bot in paper trading mode
```powershell
npm run dev
```

### Verify all systems start
Check logs for:
- ✅ Phase 1-8 COMPLETE
- ✅ API Server started on port 3001
- ✅ All systems operational

### Test API endpoints
Open new terminal:
```powershell
# Health check
curl http://localhost:3001/health

# Bot status
curl http://localhost:3001/api/status

# List all endpoints
curl http://localhost:3001/
```

### Connect dashboard
Update dashboard `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### Let it run for 30 minutes
- Watch for errors in logs
- Check Telegram alerts arrive
- Verify API endpoints work
- Test dashboard connection

---

## 7. GitHub Setup ⏳

### Create GitHub repository (if not done)
```powershell
cd c:\Users\dunze\OneDrive\Desktop\OURMM
git init
git add .
git commit -m "Initial commit: Trading bot with REST API"
```

### Push to GitHub
```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### CRITICAL: Verify .env is NOT committed
```powershell
git status
```
- `.env` should NOT appear in the list
- Should be in `.gitignore`

---

## 8. Render Setup ⏳

### Create Render account
- Sign up: https://render.com/
- Connect your GitHub account

### Create PostgreSQL database
1. New → PostgreSQL
2. Name: `memecoin-bot-db`
3. Database: `memecoin_bot`
4. Plan: **Starter ($7/month)**
5. Region: Choose closest to you
6. Create Database
7. **Copy the Internal Database URL** (starts with `postgresql://`)

### Create Redis instance
1. New → Redis
2. Name: `memecoin-bot-redis`
3. Plan: **Starter ($10/month)**
4. Region: Same as database
5. Create Redis
6. **Copy the Internal Redis URL** (starts with `redis://`)

### Create Web Service (Bot + API)
1. New → Web Service
2. Connect your GitHub repository
3. Name: `memecoin-bot-api`
4. Environment: **Node**
5. Build Command: `npm install && npm run build`
6. Start Command: `npm start`
7. Plan: **Free** (or Starter for $7/month - no sleep)
8. Add environment variables (see step 8a below)
9. Create Web Service

### Create Static Site (Dashboard)
1. New → Static Site
2. Connect your dashboard repository
3. Name: `memecoin-bot-dashboard`
4. Build Command: `npm run build`
5. Publish directory: `out` or `dist` (depends on your Next.js config)
6. Add env var: `NEXT_PUBLIC_API_URL=https://memecoin-bot-api.onrender.com/api`
7. Create Static Site

---

## 8a. Render Environment Variables (CRITICAL) ⏳

Add these to your Bot Web Service on Render:

```
NODE_ENV=production
API_PORT=3001

# Database (use Internal URLs from Render)
DATABASE_URL=[Internal PostgreSQL URL from Render]
REDIS_URL=[Internal Redis URL from Render]

# Solana RPC
SOLANA_RPC_PRIMARY=[Your Helius URL]
SOLANA_RPC_SECONDARY=[Your QuickNode URL]
SOLANA_RPC_TERTIARY=[Your Triton URL]

# Bot Wallet (MARK AS SECRET!)
WALLET_PRIVATE_KEY=[Your base58 private key]

# Telegram
TELEGRAM_BOT_TOKEN=[Your bot token]
TELEGRAM_ALERT_CHAT_ID=[Your chat ID]

# Trading Config
MAX_POSITION_SIZE_PERCENT=5
MAX_DAILY_LOSS_PERCENT=8
MAX_DAILY_PROFIT_PERCENT=15
DEFAULT_STOP_LOSS_PERCENT=25
MAX_OPEN_POSITIONS=5

# Conviction Thresholds
HIGH_CONVICTION_THRESHOLD=85
MEDIUM_CONVICTION_THRESHOLD=70
LOW_CONVICTION_THRESHOLD=50

# Operational
ENABLE_TRADING=false
PAPER_TRADING_MODE=true
ENABLE_KILL_SWITCH=true
LOG_LEVEL=info

# Slippage & Execution
MAX_BUY_SLIPPAGE=5
MAX_SELL_SLIPPAGE=8
MAX_EMERGENCY_SLIPPAGE=15
PRIORITY_FEE_MULTIPLIER=1.5
BASE_PRIORITY_FEE_LAMPORTS=10000
MAX_PRIORITY_FEE_LAMPORTS=100000
EXECUTION_TIMEOUT_MS=30000
```

**IMPORTANT**: Mark `WALLET_PRIVATE_KEY` as "secret" in Render!

---

## 9. Deployment Validation ⏳

### Wait for Render deployment
- Watch build logs
- Should complete in 3-5 minutes

### Test production API
```powershell
# Health check
curl https://memecoin-bot-api.onrender.com/health

# Bot status
curl https://memecoin-bot-api.onrender.com/api/status
```

### Check Render logs
- Look for all phases completing
- Verify no errors

### Keep bot awake (free tier only)
If using free tier, set up cron-job.org:
1. Sign up: https://cron-job.org/
2. Create job: ping `https://memecoin-bot-api.onrender.com/health` every 10 minutes
3. This prevents the free tier from sleeping

---

## 10. Paper Trading Phase (1-2 WEEKS MINIMUM) ⏳

### Run with paper trading enabled
- `ENABLE_TRADING=false`
- `PAPER_TRADING_MODE=true`

### Monitor for 1-2 weeks
- Does it detect opportunities?
- Are conviction scores reasonable?
- Would exits happen correctly?
- Any crashes or errors?
- RPC connection stable?
- Database performing well?

### Review metrics
- Win rate > 30%?
- No critical bugs?
- Position tracking accurate?
- Telegram alerts working?

---

## 11. Go Live (ONLY AFTER PAPER TRADING SUCCESS) ⏳

### Update environment variables on Render
```
ENABLE_TRADING=true
PAPER_TRADING_MODE=false
MAX_POSITION_SIZE_PERCENT=1  # Start SMALL!
```

### Fund bot wallet (START SMALL!)
- $100-200 total capital
- Test with 5-10 real trades

### Monitor closely (daily)
- Check every position
- Verify stop-losses work
- Confirm take-profits execute
- Watch Telegram alerts

### Gradually scale up
After 10 successful trades:
- Increase position size to 2%
- Add more capital
- Continue monitoring

---

## 12. Ongoing Maintenance ⏳

### Daily
- Check Telegram for alerts
- Review open positions
- Monitor daily P&L

### Weekly
- Review trade history
- Check win rate and profit factor
- Verify Learning Engine adjustments
- Check RPC provider costs

### Monthly
- Rotate API keys
- Review and update smart wallet list
- Check for bot updates
- Backup database (Render auto-backups)

### Quarterly
- Review overall performance
- Adjust parameters if needed
- Update dependencies
- Security audit

---

## Cost Summary

### Development/Testing Phase
- **PostgreSQL**: $7/month
- **Redis**: $10/month
- **Helius Developer**: $29/month
- **Bot/Dashboard**: FREE on Render
- **Total**: ~$46/month

### Production Phase
- **PostgreSQL**: $7/month
- **Redis**: $10/month
- **Helius Growth**: $99/month
- **QuickNode Build**: $49/month (optional)
- **Bot/Dashboard**: $7/month if you want no-sleep (optional)
- **Total**: ~$116-172/month

### Trading Capital
- **Paper trading**: $0
- **Small live test**: $100-200
- **Full production**: $500-2000 (your choice)

---

## Emergency Procedures

### Kill Switch
If something goes wrong:
```powershell
# Via API
curl -X POST http://localhost:3001/api/controls/kill-switch

# Via Telegram (if commands enabled)
/kill
```

### Pause Trading
```powershell
# Via API
curl -X POST http://localhost:3001/api/controls/pause
```

### Check Logs
```powershell
# Local
tail -f logs/combined.log

# Render
Check Render dashboard → Logs tab
```

---

## Security Reminders

- ✅ Never commit `.env` file
- ✅ Never share private keys
- ✅ Use dedicated bot wallet only
- ✅ Store seed phrase on paper offline
- ✅ Mark sensitive env vars as "secret" on Render
- ✅ Start with small capital
- ✅ Test everything in paper trading first
- ✅ Monitor closely when live
- ✅ Keep bot wallet separate from main funds

---

## Support & Resources

- **Plan**: `C:\Users\dunze\.claude\plans\mossy-weaving-blossom.md`
- **API Docs**: http://localhost:3001/ (when running)
- **Render Docs**: https://render.com/docs
- **Solana Docs**: https://docs.solana.com/
- **Helius Docs**: https://docs.helius.dev/

---

**Last Updated**: Today
**Status**: Ready for setup when you are!
