import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HumanTask } from '@/types';
import { cn } from '@/lib/utils';
import { Clock, AlertCircle } from 'lucide-react';

interface TaskCardProps {
    task: HumanTask;
}

export function TaskCard({ task }: TaskCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id, data: { type: 'Task', task } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={cn("opacity-50", "h-[150px] w-full rounded-xl border-2 border-primary/20 bg-background")}
            />
        );
    }

    const priorityColor = {
        low: "bg-slate-500",
        normal: "bg-blue-500",
        high: "bg-orange-500",
        critical: "bg-red-500",
    }[task.priority] || "bg-slate-500";

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none mb-3">
            <Card className="hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing border-l-4" style={{ borderLeftColor: priorityColor.replace('bg-', '') }}>
                <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start">
                        <CardTitle className="text-sm font-medium leading-none line-clamp-2">
                            {task.activity_name}
                        </CardTitle>
                        <Badge variant="outline" className={cn("text-[10px] uppercase", priorityColor, "text-white border-transparent")}>
                            {task.priority}
                        </Badge>
                    </div>
                    <CardDescription className="text-xs pt-1 truncate">
                        ID: {task.id.slice(0, 8)}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                    <p className="text-xs text-muted-foreground line-clamp-3">
                        {task.description || "No description provided."}
                    </p>
                </CardContent>
                <CardFooter className="p-4 pt-0 text-xs text-muted-foreground flex justify-between items-center">
                    <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(task.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {task.due_at && (
                        <div className="flex items-center gap-1 text-red-500">
                            <AlertCircle className="w-3 h-3" />
                            <span>Due</span>
                        </div>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
