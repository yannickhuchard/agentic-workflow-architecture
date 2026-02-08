import { KanbanBoard } from '@/components/kanban/board';
import { ChatInterface } from '@/components/chat/chat-interface';

export default function Home() {
  return (
    <main className="flex h-screen w-full bg-background overflow-hidden font-sans">
      <div className="flex-1 h-full min-w-0 flex flex-col">
        <header className="h-14 border-b flex items-center px-6 bg-background">
          <h1 className="font-semibold text-lg tracking-tight">Agentic Workflow Kanban</h1>
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
