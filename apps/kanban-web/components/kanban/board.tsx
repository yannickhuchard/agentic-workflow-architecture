'use client';

import React, { useEffect, useState } from 'react';
import { DndContext, DragOverlay, useSensors, useSensor, PointerSensor, closestCorners } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { KanbanColumn } from './column';
import { TaskCard } from './task-card';
import { useKanbanStore } from '@/hooks/use-kanban-store';
import { HumanTaskStatus, HumanTask } from '@/types';
import { createPortal } from 'react-dom';

const columns: { id: HumanTaskStatus; title: string }[] = [
    { id: 'pending', title: 'To Do' },
    { id: 'assigned', title: 'Assigned' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'completed', title: 'Done' },
];

export function KanbanBoard() {
    const { tasks, fetchTasks, moveTask } = useKanbanStore();
    const [activeTask, setActiveTask] = useState<HumanTask | null>(null);

    // Hydration fix check
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(fetchTasks, 5000); // Polling every 5s
        return () => clearInterval(interval);
    }, [fetchTasks]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    function onDragStart(event: any) {
        if (event.active.data.current?.type === 'Task') {
            setActiveTask(event.active.data.current.task);
        }
    }

    function onDragEnd(event: any) {
        setActiveTask(null);
        const { active, over } = event;

        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        const activeTask = tasks.find((t) => t.id === activeId);
        if (!activeTask) return;

        // Dropped over a column
        if (columns.map(c => c.id).includes(overId)) {
            if (activeTask.status !== overId) {
                moveTask(activeId, overId as HumanTaskStatus);
            }
            return;
        }

        // Dropped over another task
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask && activeTask.status !== overTask.status) {
            moveTask(activeId, overTask.status);
        }
    }

    if (!mounted) return null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
        >
            <div className="flex h-full gap-4 p-4 overflow-x-auto items-start">
                {columns.map((col) => (
                    <div key={col.id} className="w-[300px] flex-shrink-0 h-full max-h-full">
                        <KanbanColumn
                            id={col.id}
                            title={col.title}
                            tasks={tasks.filter((t) => t.status === col.id)}
                        />
                    </div>
                ))}
            </div>

            {createPortal(
                <DragOverlay>
                    {activeTask && <TaskCard task={activeTask} />}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
}
