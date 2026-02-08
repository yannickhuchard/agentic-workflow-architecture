'use client';

import { useChat } from '@ai-sdk/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Bot, User } from 'lucide-react';

export function ChatInterface() {
    const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
        api: '/api/chat',
    });

    return (
        <Card className="h-full flex flex-col border-l rounded-none border-t-0 border-b-0">
            <CardHeader className="p-4 border-b">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Bot className="w-4 h-4" />
                    AI Assistant
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0 bg-muted/20">
                <ScrollArea className="h-full p-4">
                    <div className="flex flex-col gap-4">
                        {messages.length === 0 && (
                            <div className="text-center text-xs text-muted-foreground mt-10">
                                Ask me anything about your tasks!
                            </div>
                        )}
                        {messages.map(m => (
                            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <Avatar className="w-8 h-8">
                                    <AvatarFallback>{m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}</AvatarFallback>
                                </Avatar>
                                <div className={`rounded-lg p-3 text-sm max-w-[80%] ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                                    {m.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-3">
                                <Avatar className="w-8 h-8"><AvatarFallback><Bot className="w-4 h-4 animate-pulse" /></AvatarFallback></Avatar>
                                <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">Thinking...</div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
            <CardFooter className="p-4 border-t bg-background">
                <form onSubmit={handleSubmit} className="flex w-full gap-2">
                    <Input
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                        className="flex-1"
                    />
                    <Button type="submit" size="icon" disabled={isLoading}>
                        <Send className="w-4 h-4" />
                    </Button>
                </form>
            </CardFooter>
        </Card>
    );
}
