import { Router, type IRouter } from "express";
import {
  CreateTaskBody,
  DeleteTaskParams,
} from "@workspace/api-zod";
import { store } from "../lib/store.js";
import { sendMessage } from "../lib/telegram.js";

const router: IRouter = Router();

const taskIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

router.get("/tasks", async (_req, res): Promise<void> => {
  const tasks = store.listTasks();
  res.json(tasks);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const task = store.addTask({
    name: parsed.data.name,
    description: parsed.data.description,
    mode: parsed.data.mode as any,
    customQuery: parsed.data.customQuery,
    cronExpression: parsed.data.cronExpression,
  });

  if (parsed.data.cronExpression) {
    const intervalMs = parseCronToMs(parsed.data.cronExpression);
    if (intervalMs > 0) {
      const interval = setInterval(async () => {
        const currentTask = store.tasks.get(task.id);
        if (!currentTask || !currentTask.active) {
          clearInterval(interval);
          taskIntervals.delete(task.id);
          return;
        }
        store.addActivity("task", `Scheduled task "${task.name}" triggered`);
        await sendMessage(
          `⏰ <b>Scheduled Task Triggered</b>\n\nTask: ${task.name}\nMode: ${task.mode}\n${task.description ? `Description: ${task.description}` : ""}`
        );
      }, intervalMs);
      taskIntervals.set(task.id, interval);
    }
  }

  await sendMessage(
    `📅 <b>New Task Scheduled</b>\n\nTask: ${task.name}\nMode: ${task.mode}\n${task.cronExpression ? `Schedule: ${task.cronExpression}` : "One-time"}`
  );

  res.status(201).json(task);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const deleted = store.deleteTask(raw);
  if (!deleted) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const interval = taskIntervals.get(raw);
  if (interval) {
    clearInterval(interval);
    taskIntervals.delete(raw);
  }

  res.json({ message: "Task deleted successfully" });
});

function parseCronToMs(expression: string): number {
  const parts = expression.toLowerCase().trim();
  if (parts.includes("hourly") || parts === "0 * * * *") return 60 * 60 * 1000;
  if (parts.includes("daily") || parts === "0 0 * * *") return 24 * 60 * 60 * 1000;
  if (parts.includes("weekly") || parts === "0 0 * * 0") return 7 * 24 * 60 * 60 * 1000;
  const match = parts.match(/every\s+(\d+)\s*(m|min|h|hr|hour|d|day)/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2].charAt(0).toLowerCase();
    if (unit === "m") return val * 60 * 1000;
    if (unit === "h") return val * 60 * 60 * 1000;
    if (unit === "d") return val * 24 * 60 * 60 * 1000;
  }
  return 0;
}

export default router;
