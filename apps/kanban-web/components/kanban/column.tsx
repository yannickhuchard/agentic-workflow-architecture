import React from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HumanTask, HumanTaskStatus } from '@/types';
import { TaskCard } from './task-card';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
    id: HumanTaskStatus;
    title: string;
    tasks: HumanTask[];
}

export function KanbanColumn({ id, title, tasks }: KanbanColumnProps) {
    const { setNodeRef } = useDroppable({
        id: id,
    });

    return (
        <Card className="h-full flex flex-col bg-muted/50 border-none shadow-none">
            <CardHeader className="p-4 pb-2 space-y-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        {title}
                    </CardTitle>
                    <span className="bg-background text-xs font-medium px-2 py-0.5 rounded-full border">
                        {tasks.length}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="p-2 flex-1 min-h-0">
                <div ref={setNodeRef} className={cn("h-full rounded-md p-1", tasks.length === 0 && "border-2 border-dashed border-muted-foreground/20")}>
                    <ScrollArea className="h-full pr-3">
                        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                            <div className="flex flex-col gap-2 pb-4">
                                {tasks.map((task) => (
                                    <TaskCard key={task.id} task={task} />
                                ))}
                                {tasks.length === 0 && (
                                    <div className="h-20 flex items-center justify-center text-xs text-muted-foreground italic">
                                        No tasks
                                    </div>
                                )}
                            </div>
                        </SortableContext>
                    </ScrollArea>
                </div>
            </CardContent>
        </Card>
    );
}
