import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";
import { sendMessage, getPaymentUrl } from "../lib/telegram.js";
import { streamAnalysis } from "../lib/venice.js";

const router: IRouter = Router();

const taskIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

router.get("/tasks", async (_req, res): Promise<void> => {
  const tasks = store.listTasks();
  res.json(tasks);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body?.name || !body?.actionType) {
    res.status(400).json({ error: "name and actionType are required" });
    return;
  }

  const validActionTypes = ["analyze_document", "send_reminder", "charge_client", "report_messages"];
  if (!validActionTypes.includes(body.actionType)) {
    res.status(400).json({ error: `Invalid actionType. Must be one of: ${validActionTypes.join(", ")}` });
    return;
  }

  if (body.actionType === "send_reminder" && !body.reminderText && !body.description) {
    res.status(400).json({ error: "reminderText or description is required for send_reminder tasks" });
    return;
  }
  if (body.actionType === "charge_client") {
    const amount = Number(body.chargeAmount);
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "chargeAmount must be a positive number for charge_client tasks" });
      return;
    }
  }

  if (body.cronExpression) {
    const intervalMs = parseCronToMs(body.cronExpression);
    if (intervalMs <= 0) {
      res.status(400).json({ error: `Unsupported cronExpression "${body.cronExpression}". Use formats like "every 5m", "hourly", "daily", or "weekly".` });
      return;
    }
  }

  const task = store.addTask({
    name: body.name,
    description: body.description,
    actionType: body.actionType,
    mode: body.mode,
    customQuery: body.customQuery,
    reminderText: body.reminderText,
    targetChatId: body.targetChatId,
    chargeAmount: body.chargeAmount ? Number(body.chargeAmount) : undefined,
    cronExpression: body.cronExpression,
  });

  if (body.cronExpression) {
    const intervalMs = parseCronToMs(body.cronExpression);
    if (intervalMs > 0) {
      const interval = setInterval(async () => {
        const currentTask = store.tasks.get(task.id);
        if (!currentTask || !currentTask.active) {
          clearInterval(interval);
          taskIntervals.delete(task.id);
          return;
        }
        await executeTask(currentTask);
        currentTask.lastRunAt = new Date().toISOString();
      }, intervalMs);
      taskIntervals.set(task.id, interval);
    }
  } else {
    setTimeout(async () => {
      const currentTask = store.tasks.get(task.id);
      if (currentTask && currentTask.active) {
        await executeTask(currentTask);
        currentTask.lastRunAt = new Date().toISOString();
        currentTask.active = false;
      }
    }, 1000);
  }

  await sendMessage(
    `📅 <b>New Task Scheduled</b>\n\nTask: ${task.name}\nAction: ${formatActionType(task.actionType)}\n${task.cronExpression ? `Schedule: ${task.cronExpression}` : "One-time (runs immediately)"}`
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

async function executeTask(task: import("../lib/store.js").ScheduledTask): Promise<void> {
  store.addActivity("task", `Executing task "${task.name}" (${formatActionType(task.actionType)})`);

  switch (task.actionType) {
    case "analyze_document": {
      const mode = (task.mode as "summarize" | "extract_clauses" | "flag_risks" | "custom") || "summarize";
      const description = task.description || task.name;
      const documentTexts = [description];

      store.addActivity("task", `Task "${task.name}": Running Venice AI analysis (${mode})`);

      try {
        let analysisResult = "";
        for await (const chunk of streamAnalysis({
          mode,
          customQuery: task.customQuery,
          documentTexts,
        })) {
          analysisResult += chunk;
        }

        const truncated = analysisResult.length > 3500
          ? analysisResult.substring(0, 3500) + "\n\n... [truncated]"
          : analysisResult;

        await sendMessage(
          `🔍 <b>Scheduled Analysis Complete</b>\n\nTask: ${task.name}\nMode: ${mode}\n\n<pre>${truncated}</pre>`
        );
        store.addActivity("analysis", `Task "${task.name}": Venice AI analysis complete (${analysisResult.length} chars)`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await sendMessage(
          `❌ <b>Analysis Failed</b>\n\nTask: ${task.name}\nError: ${errorMsg}`
        );
        store.addActivity("task", `Task "${task.name}": Analysis failed — ${errorMsg}`);
      }
      break;
    }

    case "send_reminder": {
      const reminderText = task.reminderText || task.description || "Scheduled reminder from Citadelle Legal Platform";
      const targetChat = task.targetChatId || undefined;
      await sendMessage(`📌 <b>Reminder</b>\n\n${reminderText}`, targetChat);
      store.addActivity("task", `Task "${task.name}": Reminder sent${targetChat ? ` to chat ${targetChat}` : ""}`);
      break;
    }

    case "charge_client": {
      const amount = task.chargeAmount || 0;
      const targetChat = task.targetChatId || undefined;
      if (amount > 0) {
        const charge = store.addCharge(String(amount), task.description || task.name);
        const { getLocusWalletAddress } = await import("../lib/locus.js");
        const locusWallet = await getLocusWalletAddress();
        if (locusWallet) {
          store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
        }
        const payUrl = getPaymentUrl(charge.id);
        if (targetChat) {
          await sendMessage(
            `💳 <b>Payment Request</b>\n\nAmount: ${amount} USDC\nPayment Link: <a href="${payUrl}">${payUrl}</a>${locusWallet ? "\n💎 <i>Powered by Locus</i>" : ""}\n\nClick the link above to pay via MetaMask on Base network.`,
            targetChat
          );
        }
        await sendMessage(
          `💳 <b>Charge Created (Scheduled)</b>\n\nTask: ${task.name}\nAmount: ${amount} USDC\nPayment Link: <a href="${payUrl}">${payUrl}</a>${locusWallet ? "\n💎 <i>Powered by Locus</i>" : ""}`
        );
        store.addActivity("payment", `Task "${task.name}": Charge created for ${amount} USDC — ${payUrl}`);
      } else {
        await sendMessage(
          `💳 <b>Charge Client Task</b>\n\nTask: ${task.name}\nAmount: ${amount} USDC\n${task.description || ""}\n\n<i>Set a positive chargeAmount to create a real charge.</i>`
        );
        store.addActivity("task", `Task "${task.name}": Charge notification sent (no amount)`);
      }
      break;
    }

    case "report_messages": {
      const recentActivity = store.getActivity(20);
      const telegramMessages = recentActivity
        .filter(a => a.type === "telegram" && a.message.startsWith("Incoming"))
        .slice(-10);

      let digest = `📊 <b>Message Report</b>\n\nTask: ${task.name}\n\n`;
      if (telegramMessages.length === 0) {
        digest += "No incoming messages in the recent activity log.";
      } else {
        digest += `<b>${telegramMessages.length} recent messages:</b>\n\n`;
        for (const m of telegramMessages) {
          digest += `• ${m.message}\n  <i>${m.timestamp}</i>\n\n`;
        }
      }
      await sendMessage(digest);
      store.addActivity("task", `Task "${task.name}": Message digest sent (${telegramMessages.length} messages)`);
      break;
    }
  }
}

function formatActionType(actionType: string): string {
  const labels: Record<string, string> = {
    analyze_document: "Analyze Document",
    send_reminder: "Send Reminder",
    charge_client: "Charge Client",
    report_messages: "Report Messages",
  };
  return labels[actionType] || actionType;
}

function parseCronToMs(expression: string): number {
  const parts = expression.toLowerCase().trim();
  if (parts.includes("hourly") || parts === "0 * * * *") return 60 * 60 * 1000;
  if (parts.includes("daily") || parts === "0 0 * * *") return 24 * 60 * 60 * 1000;
  if (parts.includes("weekly") || parts === "0 0 * * 0") return 7 * 24 * 60 * 60 * 1000;
  const match = parts.match(/every\s+(\d+)\s*(m|min|h|hr|hour|d|day|s|sec)/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2].charAt(0).toLowerCase();
    if (unit === "s") return val * 1000;
    if (unit === "m") return val * 60 * 1000;
    if (unit === "h") return val * 60 * 60 * 1000;
    if (unit === "d") return val * 24 * 60 * 60 * 1000;
  }
  return 0;
}

export default router;
