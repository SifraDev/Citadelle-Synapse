import { useState } from "react";
import { format } from "date-fns";
import { 
  CalendarClock, 
  Plus, 
  Trash2, 
  X,
  Sparkles,
  Bell,
  CreditCard,
  MessageSquare
} from "lucide-react";
import { useListTasks, useCreateTask, useDeleteTask, getListTasksQueryKey } from "@workspace/api-client-react";
import type { CreateTaskInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const ACTION_TYPES = [
  { id: "analyze_document", label: "Analyze Document", icon: Sparkles, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
  { id: "send_reminder", label: "Send Reminder", icon: Bell, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  { id: "charge_client", label: "Charge Client", icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  { id: "report_messages", label: "Report Messages", icon: MessageSquare, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
] as const;

export default function Scheduler() {
  const { data: tasks, isLoading } = useListTasks();
  const { mutate: deleteTask, isPending: isDeleting } = useDeleteTask();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this scheduled task?")) {
      deleteTask({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() })
      });
    }
  };

  const getActionConfig = (actionType: string) => {
    return ACTION_TYPES.find(a => a.id === actionType) || ACTION_TYPES[0];
  };

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-display text-foreground">Task Scheduler</h1>
          <p className="text-muted-foreground mt-1">Schedule automated actions: analysis, reminders, invoices, and reports.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4" /> New Task
        </button>
      </header>

      <div className="bg-card rounded-2xl border border-border shadow-xl shadow-black/20 overflow-hidden flex-1">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">Loading tasks...</div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <CalendarClock className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-lg">No tasks scheduled</p>
            <p className="text-sm mt-1">Create a task to automate workflows, reminders, and billing.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-xs font-semibold">
                <tr>
                  <th className="px-6 py-4 rounded-tl-2xl">Task Name</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Schedule</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Last Run</th>
                  <th className="px-6 py-4 text-right rounded-tr-2xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasks.map((task) => {
                  const actionConfig = getActionConfig(task.actionType);
                  const ActionIcon = actionConfig.icon;
                  return (
                    <tr key={task.id} className="hover:bg-secondary/20 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{task.name}</p>
                        {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${actionConfig.bg} ${actionConfig.color}`}>
                          <ActionIcon className="w-3 h-3" />
                          {actionConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-muted-foreground">
                        {task.cronExpression || 'Run Once'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${task.active ? 'bg-emerald-500' : 'bg-muted'}`} />
                          <span className={task.active ? 'text-emerald-500' : 'text-muted-foreground'}>
                            {task.active ? 'Active' : 'Completed'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        {task.lastRunAt ? format(new Date(task.lastRunAt), "MMM d, HH:mm") : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleDelete(task.id)}
                          disabled={isDeleting}
                          className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <CreateTaskModal onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}

function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const { mutate: createTask, isPending } = useCreateTask();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    actionType: "analyze_document" as string,
    mode: "summarize" as string,
    customQuery: "",
    reminderText: "",
    targetChatId: "",
    chargeAmount: "",
    cronExpression: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateTaskInput = {
      name: formData.name,
      actionType: formData.actionType as CreateTaskInput["actionType"],
      description: formData.description || undefined,
      cronExpression: formData.cronExpression || undefined,
    };

    if (formData.actionType === "analyze_document") {
      payload.mode = formData.mode as CreateTaskInput["mode"];
      if (formData.mode === "custom") payload.customQuery = formData.customQuery;
    } else if (formData.actionType === "send_reminder") {
      payload.reminderText = formData.reminderText;
      if (formData.targetChatId) payload.targetChatId = formData.targetChatId;
    } else if (formData.actionType === "charge_client") {
      payload.chargeAmount = Number(formData.chargeAmount) || 0;
      if (formData.targetChatId) payload.targetChatId = formData.targetChatId;
    }

    createTask({ data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border bg-secondary/30">
          <h2 className="text-lg font-semibold text-foreground">Create Scheduled Task</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Task Name</label>
            <input 
              required
              type="text" 
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
              placeholder="e.g., Daily Contract Review"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Action Type</label>
            <div className="grid grid-cols-2 gap-2">
              {ACTION_TYPES.map(action => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setFormData({...formData, actionType: action.id})}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
                      formData.actionType === action.id 
                        ? `${action.bg} ${action.color} shadow-sm` 
                        : "bg-background border-border text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          {formData.actionType === "analyze_document" && (
            <>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">Analysis Mode</label>
                <select 
                  value={formData.mode}
                  onChange={e => setFormData({...formData, mode: e.target.value})}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                >
                  <option value="summarize">Summarize</option>
                  <option value="extract_clauses">Extract Clauses</option>
                  <option value="flag_risks">Flag Risks</option>
                  <option value="custom">Custom Query</option>
                </select>
              </div>
              {formData.mode === "custom" && (
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1.5">Custom Prompt</label>
                  <textarea 
                    required
                    value={formData.customQuery}
                    onChange={e => setFormData({...formData, customQuery: e.target.value})}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 resize-none h-20"
                    placeholder="Enter custom analysis prompt..."
                  />
                </div>
              )}
            </>
          )}

          {formData.actionType === "send_reminder" && (
            <>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">Reminder Message</label>
                <textarea 
                  required
                  value={formData.reminderText}
                  onChange={e => setFormData({...formData, reminderText: e.target.value})}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 resize-none h-20"
                  placeholder="e.g., Follow up with client about contract revision"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">Target Chat ID <span className="text-xs opacity-60">(optional, defaults to CEO)</span></label>
                <input 
                  type="text" 
                  value={formData.targetChatId}
                  onChange={e => setFormData({...formData, targetChatId: e.target.value})}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                  placeholder="Telegram chat ID"
                />
              </div>
            </>
          )}

          {formData.actionType === "charge_client" && (
            <>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">Amount (USDC)</label>
                <input 
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.chargeAmount}
                  onChange={e => setFormData({...formData, chargeAmount: e.target.value})}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  placeholder="e.g., 50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">Client Chat ID <span className="text-xs opacity-60">(optional)</span></label>
                <input 
                  type="text" 
                  value={formData.targetChatId}
                  onChange={e => setFormData({...formData, targetChatId: e.target.value})}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 font-mono text-sm"
                  placeholder="Telegram chat ID of client"
                />
              </div>
            </>
          )}

          {formData.actionType === "report_messages" && (
            <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-cyan-400 text-sm">
              This task will compile a digest of all recent incoming Telegram messages and send it to the CEO channel.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Description <span className="text-xs opacity-60">(optional)</span></label>
            <input 
              type="text" 
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
              placeholder="Brief description of this task"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Schedule</label>
            <input 
              type="text" 
              value={formData.cronExpression}
              onChange={e => setFormData({...formData, cronExpression: e.target.value})}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 font-mono text-sm"
              placeholder="e.g., every 30m, hourly, daily (leave empty for run-once)"
            />
            <p className="text-xs text-muted-foreground mt-1.5">Supports: "every Nm/h/d", "hourly", "daily", "weekly". Leave empty to run once immediately.</p>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
