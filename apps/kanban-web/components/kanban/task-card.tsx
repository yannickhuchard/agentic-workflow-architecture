import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HumanTask } from '@/types';
import { cn } from '@/lib/utils';
import { Clock, AlertCircle, Bot, User, Smartphone, Monitor } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TaskDetailDialog } from './task-detail-dialog';

interface TaskCardProps {
    task: HumanTask;
}

const ActorIcon = ({ type, className }: { type?: string, className?: string }) => {
    switch (type) {
        case 'ai_agent': return <Bot className={className} />;
        case 'robot': return <Smartphone className={className} />;
        case 'application': return <Monitor className={className} />;
        case 'human': return <User className={className} />;
        default: return <User className={className} />;
    }
};

const ActorBadge = ({ type, label }: { type?: string, label: string }) => {
    const colors = {
        ai_agent: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        robot: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        application: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        human: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    } as any;

    return (
        <Badge variant="secondary" className={cn("text-[10px] px-1 py-0 h-5 gap-1", colors[type || 'human'])}>
            <ActorIcon type={type} className="w-3 h-3" />
            <span className="truncate max-w-[80px]">{label}</span>
        </Badge>
    );
};

export function TaskCard({ task }: TaskCardProps) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

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

    // Visual differentiation based on creator type
    const actorStyles = {
        // AI Agent: Purple theme
        ai_agent: "border-purple-300 bg-purple-50/30 dark:border-purple-800 dark:bg-purple-950/10",
        // Robot: Orange theme
        robot: "border-orange-300 bg-orange-50/30 dark:border-orange-800 dark:bg-orange-950/10",
        // Application: Blue theme
        application: "border-blue-300 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/10",
        // Human: Standard/Greenish hint
        human: "border-border bg-card",
    }[task.creator_type || 'human'] || "border-border bg-card";

    return (
        <>
            <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none mb-3">
                <Card
                    className={cn(
                        "hover:shadow-md transition-all cursor-grab active:cursor-grabbing border-l-4",
                        actorStyles
                    )}
                    style={{ borderLeftColor: priorityColor.replace('bg-', '') }}
                    onClick={() => setIsDialogOpen(true)}
                >
                    <CardHeader className="p-3 pb-2 space-y-2">
                        <div className="flex justify-between items-start gap-2">
                            <CardTitle className="text-sm font-medium leading-tight line-clamp-2">
                                {task.activity_name}
                            </CardTitle>
                            <Badge variant="outline" className={cn("text-[10px] uppercase shrink-0", priorityColor, "text-white border-transparent")}>
                                {task.priority}
                            </Badge>
                        </div>
                        {/* Actor Info Section */}
                        <div className="flex flex-wrap gap-2 pt-1">
                            {task.creator_type && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground" title={`Created by ${task.creator_id}`}>
                                    <span className="text-[10px]">By:</span>
                                    <ActorBadge type={task.creator_type} label={task.creator_type === 'ai_agent' ? 'AI Agent' : task.creator_type} />
                                </div>
                            )}
                            {task.assignee_id && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                                    <span className="text-[10px]">To:</span>
                                    <div className="flex items-center gap-1">
                                        <Avatar className="h-4 w-4">
                                            <AvatarFallback className="text-[8px] bg-slate-200">
                                                {task.assignee_id.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="text-[10px] font-medium">{task.assignee_id}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {task.description || "No description provided."}
                        </p>
                    </CardContent>
                    <CardFooter className="p-3 pt-0 text-xs text-muted-foreground flex justify-between items-center border-t mt-2 pt-2 border-border/50">
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

            <TaskDetailDialog
                task={task}
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
            />
        </>
    );
}
