# 🤖 Solana Memecoin Trading Bot V3.0

An autonomous, self-improving trading bot for Solana meme coins with adaptive learning engine.

## 🎯 Features

- **Smart Wallet Discovery**: Automatically finds and tracks successful early buyers
- **Token Safety Analysis**: Contract analysis, honeypot detection, blacklist management
- **Conviction-Based Scoring**: Weighted scoring system (0-100) for trade decisions
- **Adaptive Learning Engine**: Continuously improves through pattern recognition and parameter tuning
- **Risk Management**: Multi-layered stop-losses, staged take-profits, daily limits
- **Real-time Monitoring**: 24/7 position tracking with danger signal detection
- **Failover RPC**: Automatic failover across multiple Solana RPC providers
- **Alerts**: Telegram & Discord notifications for all critical events

## 📊 Architecture

```
bot/
├── src/
│   ├── core/           # Conviction engine, execution, position manager
│   ├── discovery/      # Smart wallet scanning & scoring
│   ├── safety/         # Contract analysis, honeypot detection
│   ├── market/         # Price feeds, regime detection
│   ├── social/         # Twitter, Telegram monitoring
│   ├── learning/       # Adaptive learning engine (4 levels)
│   ├── alerts/         # Telegram & Discord integration
│   ├── db/             # PostgreSQL & Redis clients
│   ├── config/         # RPC config, parameters
│   └── utils/          # Logger, metrics, encryption
├── database/           # SQL schema files
├── tests/              # Unit & integration tests
└── scripts/            # Utility scripts
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- pnpm (or npm/yarn)

### Installation

1. **Clone the repository**
```bash
git clone <repo-url>
cd OURMM
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

4. **Start PostgreSQL & Redis**
```bash
docker-compose up -d
```

5. **Run database migrations**
```bash
# Database schema is auto-loaded via docker-compose
# Verify with:
docker-compose exec postgres psql -U postgres -d memecoin_bot -c "\dt"
```

6. **Start the bot (development mode)**
```bash
pnpm run dev
```

## 🔧 Configuration

### Environment Variables

See [.env.example](.env.example) for all configuration options.

**Critical Settings:**
- `SOLANA_RPC_PRIMARY`: Your primary Solana RPC endpoint (Helius recommended)
- `ENABLE_TRADING`: Set to `false` for paper trading mode
- `PAPER_TRADING_MODE`: Test without real transactions

### Trading Parameters

Default parameters are in the database (`bot_parameters` table) and can be adjusted by the learning engine:

- **Position Size**: 1-5% per trade (based on conviction)
- **Stop Loss**: -25% (adjustable)
- **Daily Loss Limit**: -8%
- **Daily Profit Limit**: +15%
- **Max Open Positions**: 5

## 📈 Learning Engine

The bot learns from every trade through 4 levels:

1. **Pattern Memory**: Recognizes similar past trades and adjusts confidence
2. **Weight Adjustment**: Optimizes category weights based on predictive power (every 50 trades)
3. **Parameter Tuning**: Fine-tunes entry/exit parameters based on outcomes
4. **Meta-Learning**: Evaluates whether learning adjustments are helpful

All adjustments have safety guardrails and are fully reversible.

## 🔒 Security

- **Encrypted Keys**: Private keys stored encrypted with AES-256
- **Dedicated Wallet**: Bot uses isolated wallet (10-20% of total capital)
- **Kill Switch**: Emergency shutdown with auto-sell
- **Audit Log**: Tamper-proof logging of all actions
- **Rate Limiting**: Prevents API abuse

## 📊 Monitoring

### Logs
```bash
tail -f logs/combined.log   # All logs
tail -f logs/trade.log      # Trade-specific
tail -f logs/error.log      # Errors only
```

### Database GUI
- **pgAdmin**: http://localhost:5050 (admin@memecoinbot.local / admin)
- **Redis Commander**: http://localhost:8081

### Metrics

The bot tracks:
- Win rate (target: 35-45%)
- Profit factor (target: 1.5+)
- Execution latency (target: <500ms)
- Max drawdown
- Learning engine effectiveness

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

## 📋 Development Phases

- [x] Phase 1: Foundation (RPC manager, logging, database)
- [x] Phase 2: Data Collection (wallet scanner, price feeds) - [View Details](docs/PHASE2_COMPLETE.md)
- [x] Phase 3: Safety Analysis (contract analyzer, honeypot detector) - [View Details](docs/PHASE3_COMPLETE.md)
- [ ] Phase 4: Conviction Engine (scoring system)
- [ ] Phase 5: Execution (transaction builder, buy/sell)
- [ ] Phase 6: Position Management (monitoring, stops, take-profits)
- [ ] Phase 7: Learning Engine (pattern matching, optimization)
- [ ] Phase 8: Alerts & Safety (Telegram, Discord, kill switch)
- [ ] Phase 9: Testing & Tuning
- [ ] Phase 10: Production Deployment

## ⚠️ Risk Warning

This bot is for educational and research purposes. Cryptocurrency trading carries substantial risk. Features:

- Start with small capital
- Use paper trading mode first
- Monitor closely
- Understand all risks before deploying real capital

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## 📞 Support

For issues and questions, please open an issue on GitHub.

---

**Built with TypeScript, Solana Web3.js, PostgreSQL, Redis, and Winston**
