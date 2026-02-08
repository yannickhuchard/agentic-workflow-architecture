import { create } from 'zustand';
import { HumanTask, HumanTaskStatus } from '@/types';

interface KanbanState {
    tasks: HumanTask[];
    isLoading: boolean;
    error: string | null;
    fetchTasks: () => Promise<void>;
    moveTask: (taskId: string, newStatus: HumanTaskStatus, output?: any) => Promise<void>;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
    tasks: [],
    isLoading: false,
    error: null,
    fetchTasks: async () => {
        set({ isLoading: true, error: null });
        try {
            const res = await fetch('http://localhost:3001/api/v1/tasks');
            if (!res.ok) throw new Error('Failed to fetch tasks');
            const data = await res.json();
            // Ensure we handle the { tasks: [], total: N } structure
            const tasksArray = Array.isArray(data) ? data : (data.tasks || []);
            set({ tasks: tasksArray, isLoading: false });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },
    moveTask: async (taskId, newStatus, output) => {
        // Optimistic update
        const previousTasks = get().tasks;
        set({
            tasks: previousTasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t)
        });

        try {
            let url = `http://localhost:3001/api/v1/tasks/${taskId}`;
            let method = 'POST'; // Changed to POST to match the backend implementation
            let body: any = {};

            if (newStatus === 'in_progress') {
                // Backend lacks explicitly /start, maybe it's just update?
                // Looking at routes, we have /assign, /complete, /reject
                // For now, let's stick to status updates if possible, 
                // but the backend routes use specific endpoints for actions.
                url += '/assign'; // Hack: assigning to user-1 to imply in progress
                body = { user_id: 'user-1' };
            } else if (newStatus === 'completed') {
                url += '/complete';
                body = { result: output || {} };
            } else if (newStatus === 'rejected') {
                url += '/reject';
                body = { reason: output || 'Rejected from UI' };
            } else if (newStatus === 'assigned') {
                url += '/assign';
                body = { user_id: 'user-1' };
            }

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: Object.keys(body).length > 0 ? JSON.stringify(body) : JSON.stringify({})
            });

            if (!res.ok) {
                // Revert
                set({ tasks: previousTasks, error: 'Failed to update task' });
            } else {
                // Refresh to get updated server state
                const data = await res.json();
                const updatedTask = data.task || data; // Extract from wrapper if present
                set(state => ({
                    tasks: state.tasks.map(t => t.id === taskId ? updatedTask : t)
                }));
            }
        } catch (e) {
            set({ tasks: previousTasks, error: 'Network error' });
        }
    }
}));
