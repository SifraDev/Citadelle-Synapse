import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import tasksRouter from "./tasks";
import activityRouter from "./activity";
import telegramRouter from "./telegram";
import paymentsRouter from "./payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(tasksRouter);
router.use(activityRouter);
router.use(telegramRouter);
router.use(paymentsRouter);

export default router;
