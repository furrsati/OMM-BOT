import { Router } from 'express';
import statusRoutes from './status.routes';
import positionsRoutes from './positions.routes';
import tradesRoutes from './trades.routes';
import metricsRoutes from './metrics.routes';
import controlsRoutes from './controls.routes';
import learningRoutes from './learning.routes';
import marketRoutes from './market.routes';
import botRoutes from './bot.routes';
import smartWalletsRoutes from './smart-wallets.routes';
import alertsRoutes from './alerts.routes';
import logsRoutes from './logs.routes';
import settingsRoutes from './settings.routes';
import walletRoutes from './wallet.routes';
import safetyRoutes from './safety.routes';
import executionRoutes from './execution.routes';
import scannerRoutes from './scanner.routes';

const router = Router();

// Mount all route modules
router.use('/status', statusRoutes);
router.use('/positions', positionsRoutes);
router.use('/trades', tradesRoutes);
router.use('/metrics', metricsRoutes);
router.use('/controls', controlsRoutes);
router.use('/learning', learningRoutes);
router.use('/market', marketRoutes);
router.use('/bot', botRoutes);
router.use('/smart-wallets', smartWalletsRoutes);
router.use('/alerts', alertsRoutes);
router.use('/logs', logsRoutes);
router.use('/settings', settingsRoutes);
router.use('/wallet', walletRoutes);
router.use('/safety', safetyRoutes);
router.use('/execution', executionRoutes);
router.use('/scanner', scannerRoutes);

export default router;
