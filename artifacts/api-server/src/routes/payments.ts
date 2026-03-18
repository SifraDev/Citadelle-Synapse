import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";

const router: IRouter = Router();

router.get("/payments", async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const payments = store.getPayments(limit);
  res.json(payments);
});

export default router;
