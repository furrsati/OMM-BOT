import { Router } from 'express';
import statusRoutes from './status.routes';
import positionsRoutes from './positions.routes';
import tradesRoutes from './trades.routes';
import metricsRoutes from './metrics.routes';
import controlsRoutes from './controls.routes';
import learningRoutes from './learning.routes';
import marketRoutes from './market.routes';
import botRoutes from './bot.routes';

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

export default router;
