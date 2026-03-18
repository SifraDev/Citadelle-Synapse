import { useState } from "react";
import { format } from "date-fns";
import { 
  CalendarClock, 
  Plus, 
  Trash2, 
  Clock, 
  ActivitySquare,
  X
} from "lucide-react";
import { useListTasks, useCreateTask, useDeleteTask, getListTasksQueryKey } from "@workspace/api-client-react";
import type { CreateTaskInputMode } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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

  return (
    <div className="h-full flex flex-col gap-6 animate-in fade-in duration-500">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-display text-foreground">Task Scheduler</h1>
          <p className="text-muted-foreground mt-1">Manage automated analysis routines and Telegram alerts.</p>
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
            <p className="text-sm mt-1">Create a task to automate document analysis workflows.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-xs font-semibold">
                <tr>
                  <th className="px-6 py-4 rounded-tl-2xl">Task Name</th>
                  <th className="px-6 py-4">Mode</th>
                  <th className="px-6 py-4">Schedule (Cron)</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right rounded-tr-2xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-secondary/20 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="font-medium text-foreground">{task.name}</p>
                      {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground border border-border text-xs font-medium">
                        {task.mode.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">
                      {task.cronExpression || 'Run Once'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${task.active ? 'bg-emerald-500' : 'bg-muted'}`} />
                        <span className={task.active ? 'text-emerald-500' : 'text-muted-foreground'}>
                          {task.active ? 'Active' : 'Paused'}
                        </span>
                      </div>
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
                ))}
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
    mode: CreateTaskInputMode.summarize as string,
    cronExpression: "",
    customQuery: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask({ data: formData as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border bg-secondary/30">
          <h2 className="text-lg font-semibold text-foreground">Create Scheduled Task</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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

          {formData.mode === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">Custom Prompt</label>
              <textarea 
                required
                value={formData.customQuery}
                onChange={e => setFormData({...formData, customQuery: e.target.value})}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 resize-none h-20"
                placeholder="Enter prompt..."
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Schedule (Cron Expression)</label>
            <input 
              type="text" 
              value={formData.cronExpression}
              onChange={e => setFormData({...formData, cronExpression: e.target.value})}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 font-mono text-sm"
              placeholder="* * * * * (Leave empty for run-once)"
            />
            <p className="text-xs text-muted-foreground mt-1.5">Standard cron format. Sends alerts to Telegram when executed.</p>
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
