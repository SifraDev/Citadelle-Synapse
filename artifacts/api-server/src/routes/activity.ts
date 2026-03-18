import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";

const router: IRouter = Router();

router.get("/activity", async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const logs = store.getActivity(limit);
  res.json(logs);
});

router.get("/activity/stream", async (req, res): Promise<void> => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ message: "Activity stream connected" })}\n\n`);

  const unsubscribe = store.subscribeActivity((entry) => {
    res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
  });
});

export default router;
