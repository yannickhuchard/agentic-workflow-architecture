import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { HumanTask } from '@/types';
import {
    Clock,
    Calendar,
    Tag,
    Bot,
    User,
    Smartphone,
    Monitor,
    CheckCircle2,
    AlertTriangle,
    Hash
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface TaskDetailDialogProps {
    task: HumanTask;
    open: boolean;
    onOpenChange: (open: boolean) => void;
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

const PriorityBadge = ({ priority }: { priority: string }) => {
    const colors = {
        low: "bg-slate-500",
        normal: "bg-blue-500",
        high: "bg-orange-500",
        critical: "bg-red-500",
    }[priority] || "bg-slate-500";

    return (
        <Badge variant="outline" className={cn("uppercase text-white border-transparent", colors)}>
            {priority}
        </Badge>
    );
};

const StatusBadge = ({ status }: { status: string }) => {
    const styles = {
        pending: "bg-slate-100 text-slate-800 border-slate-200",
        assigned: "bg-blue-100 text-blue-800 border-blue-200",
        in_progress: "bg-indigo-100 text-indigo-800 border-indigo-200",
        completed: "bg-green-100 text-green-800 border-green-200",
        rejected: "bg-red-100 text-red-800 border-red-200",
        expired: "bg-yellow-100 text-yellow-800 border-yellow-200",
    }[status] || "bg-slate-100 text-slate-800";

    return (
        <Badge variant="outline" className={styles}>
            {status.replace('_', ' ')}
        </Badge>
    );
};

export function TaskDetailDialog({ task, open, onOpenChange }: TaskDetailDialogProps) {
    if (!task) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
                <DialogHeader className="p-6 pb-4 border-b bg-muted/20">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Hash className="w-3 h-3" />
                        <span className="font-mono">{task.id}</span>
                    </div>
                    <DialogTitle className="text-xl leading-tight text-left">{task.activity_name}</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-2 text-left" asChild>
                        <div>
                            <PriorityBadge priority={task.priority} />
                            <StatusBadge status={task.status} />
                        </div>
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1">
                    <div className="p-6 space-y-6">
                        {/* Description */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold tracking-tight">Description</h3>
                            <div className="p-3 bg-muted/30 rounded-lg border text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                {task.description || "No description provided."}
                            </div>
                        </div>

                        {/* Actors */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold tracking-tight">Created By</h3>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border">
                                        <ActorIcon type={task.creator_type} className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-sm font-medium capitalize truncate">
                                            {task.creator_type?.replace('_', ' ') || 'Unknown'}
                                        </span>
                                        <span className="text-xs text-muted-foreground truncate" title={task.creator_id}>
                                            {task.creator_id || 'System'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold tracking-tight">Assigned To</h3>
                                {task.assignee_id ? (
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-card border shadow-sm">
                                        <Avatar className="h-10 w-10 border">
                                            <AvatarFallback className="text-sm bg-primary/10 text-primary">
                                                {task.assignee_id.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-medium truncate">
                                                {task.assignee_id}
                                            </span>
                                            <span className="text-xs text-muted-foreground">Assignee</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed text-muted-foreground">
                                        <div className="h-10 w-10 rounded-full border border-dashed flex items-center justify-center">
                                            <User className="w-5 h-5 opacity-50" />
                                        </div>
                                        <span className="text-sm">Unassigned</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <Separator />

                        {/* Timestamps */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold tracking-tight">Timeline</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/20 text-center sm:text-left">
                                    <span className="text-xs text-muted-foreground flex items-center justify-center sm:justify-start gap-1">
                                        <Calendar className="w-3 h-3" /> Created
                                    </span>
                                    <span className="font-medium">{new Date(task.created_at).toLocaleDateString()}</span>
                                    <span className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleTimeString()}</span>
                                </div>

                                <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/20 text-center sm:text-left">
                                    <span className="text-xs text-muted-foreground flex items-center justify-center sm:justify-start gap-1">
                                        <Clock className="w-3 h-3" /> Updated
                                    </span>
                                    <span className="font-medium">{new Date(task.updated_at).toLocaleDateString()}</span>
                                    <span className="text-xs text-muted-foreground">{new Date(task.updated_at).toLocaleTimeString()}</span>
                                </div>

                                {task.due_at && (
                                    <div className="flex flex-col gap-1 p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 text-center sm:text-left">
                                        <span className="text-xs text-red-500 flex items-center justify-center sm:justify-start gap-1 font-medium">
                                            <AlertTriangle className="w-3 h-3" /> Due Date
                                        </span>
                                        <span className="text-red-600 dark:text-red-400 font-medium">{new Date(task.due_at).toLocaleDateString()}</span>
                                        <span className="text-xs text-red-500/80">{new Date(task.due_at).toLocaleTimeString()}</span>
                                    </div>
                                )}

                                {task.completed_at && (
                                    <div className="flex flex-col gap-1 p-2 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 text-center sm:text-left">
                                        <span className="text-xs text-green-600 flex items-center justify-center sm:justify-start gap-1 font-medium">
                                            <CheckCircle2 className="w-3 h-3" /> Completed
                                        </span>
                                        <span className="text-green-700 dark:text-green-400 font-medium">{new Date(task.completed_at).toLocaleDateString()}</span>
                                        <span className="text-xs text-green-600/80">{new Date(task.completed_at).toLocaleTimeString()}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Inputs/Data */}
                        {task.inputs && Object.keys(task.inputs).length > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-2">
                                    <h3 className="text-sm font-semibold tracking-tight">Input Data</h3>
                                    <div className="rounded-lg bg-slate-950 p-4 overflow-auto max-h-[200px] border border-slate-800 shadow-inner">
                                        <pre className="text-xs text-slate-50 font-mono">
                                            {JSON.stringify(task.inputs, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Outputs */}
                        {task.outputs && Object.keys(task.outputs).length > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-2">
                                    <h3 className="text-sm font-semibold tracking-tight">Output Data</h3>
                                    <div className="rounded-lg bg-slate-950 p-4 overflow-auto max-h-[200px] border border-slate-800 shadow-inner">
                                        <pre className="text-xs text-slate-50 font-mono">
                                            {JSON.stringify(task.outputs, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Tags */}
                        {task.tags && task.tags.length > 0 && (
                            <>
                                <Separator />
                                <div className="flex flex-wrap gap-2">
                                    {task.tags.map((tag, i) => (
                                        <Badge key={i} variant="secondary" className="text-xs px-2 py-1">
                                            <Tag className="w-3 h-3 mr-1" />
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
