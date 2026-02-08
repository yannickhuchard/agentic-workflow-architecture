import { KanbanBoard } from '@/components/kanban/board';
import { ChatInterface } from '@/components/chat/chat-interface';

export default function Home() {
  return (
    <main className="flex h-screen w-full bg-background overflow-hidden font-sans">
      <div className="flex-1 h-full min-w-0 flex flex-col">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-background">
          <h1 className="font-semibold text-lg tracking-tight">Agentic Workflow Kanban</h1>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-none">Yannick H.</p>
              <p className="text-xs text-muted-foreground">Admin</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center border text-sm font-bold text-slate-600">
              YH
            </div>
          </div>
        </header>
        <div className="flex-1 bg-slate-50/50 dark:bg-slate-950/50 overflow-hidden">
          <KanbanBoard />
        </div>
      </div>
      <div className="w-[400px] h-full border-l bg-background shadow-xl z-10 hidden lg:block">
        <ChatInterface />
      </div>
    </main>
  );
}
