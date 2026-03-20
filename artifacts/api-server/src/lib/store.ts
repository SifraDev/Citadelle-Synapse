import { randomUUID } from "crypto";

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  actionType: "analyze_document" | "send_reminder" | "charge_client" | "report_messages";
  mode?: "summarize" | "extract_clauses" | "flag_risks" | "custom";
  customQuery?: string;
  reminderText?: string;
  targetChatId?: string;
  chargeAmount?: number;
  cronExpression?: string;
  nextRun?: string;
  active: boolean;
  createdAt: string;
  lastRunAt?: string;
}

export interface ActivityEntry {
  id: string;
  type: "upload" | "analysis" | "telegram" | "payment" | "task" | "system";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeRequest {
  id: string;
  amount: string;
  label?: string;
  status: "pending" | "paid" | "expired";
  createdAt: string;
  paidAt?: string;
  txHash?: string;
  paidFrom?: string;
  locusWalletAddress?: string;
}

export interface PaymentEntry {
  id: string;
  txHash?: string;
  from?: string;
  to?: string;
  amount: string;
  token: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: string;
  network?: string;
  paymentMethod?: "direct" | "locus";
}

const MAX_ACTIVITY_ENTRIES = 500;

class InMemoryStore {
  tasks: Map<string, ScheduledTask> = new Map();
  activityLog: ActivityEntry[] = [];
  payments: PaymentEntry[] = [];
  charges: Map<string, ChargeRequest> = new Map();
  private sseClients: Set<(data: ActivityEntry) => void> = new Set();

  addTask(input: Omit<ScheduledTask, "id" | "createdAt" | "active">): ScheduledTask {
    const task: ScheduledTask = {
      ...input,
      id: randomUUID(),
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.addActivity("task", `Scheduled task created: ${task.name} (${task.actionType})`);
    return task;
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    this.tasks.delete(id);
    this.addActivity("task", `Scheduled task deleted: ${task.name}`);
    return true;
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  addActivity(
    type: ActivityEntry["type"],
    message: string,
    metadata?: Record<string, unknown>
  ): ActivityEntry {
    const entry: ActivityEntry = {
      id: randomUUID(),
      type,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.activityLog.push(entry);
    if (this.activityLog.length > MAX_ACTIVITY_ENTRIES) {
      this.activityLog = this.activityLog.slice(-MAX_ACTIVITY_ENTRIES);
    }
    for (const client of this.sseClients) {
      client(entry);
    }
    return entry;
  }

  getActivity(limit: number = 50): ActivityEntry[] {
    return this.activityLog.slice(-limit);
  }

  subscribeActivity(callback: (data: ActivityEntry) => void): () => void {
    this.sseClients.add(callback);
    return () => {
      this.sseClients.delete(callback);
    };
  }

  addPayment(input: Omit<PaymentEntry, "id">): PaymentEntry {
    const entry: PaymentEntry = { ...input, id: randomUUID() };
    this.payments.push(entry);
    this.addActivity("payment", `Payment ${entry.status}: ${entry.amount} ${entry.token}`, {
      txHash: entry.txHash,
      token: entry.token,
    });
    return entry;
  }

  getPayments(limit: number = 50): PaymentEntry[] {
    return this.payments.slice(-limit);
  }

  addCharge(amount: string, label?: string): ChargeRequest {
    const charge: ChargeRequest = {
      id: randomUUID(),
      amount,
      label,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.charges.set(charge.id, charge);
    this.addActivity("payment", `Charge created: ${amount} USDC${label ? ` for ${label}` : ""}`, {
      chargeId: charge.id,
    });
    return charge;
  }

  getCharge(id: string): ChargeRequest | undefined {
    return this.charges.get(id);
  }

  updateCharge(id: string, updates: Partial<ChargeRequest>): ChargeRequest | undefined {
    const charge = this.charges.get(id);
    if (!charge) return undefined;
    Object.assign(charge, updates);
    return charge;
  }

  listCharges(): ChargeRequest[] {
    return Array.from(this.charges.values());
  }
}

export const store = new InMemoryStore();
