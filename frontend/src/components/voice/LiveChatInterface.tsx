import { useEffect, useRef } from 'react';
import { useLiveStore } from '../../store/useLiveStore';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { Bot, User } from 'lucide-react';

/**
 * LiveChatInterface — Chat display for the Live Voice Agent.
 * Mirrors ChatInterface.tsx but reads from useLiveStore instead of useVoiceStore.
 * No audio playback buttons (Live mode streams audio in real-time).
 */
export function LiveChatInterface() {
  const { messages } = useLiveStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-6">
      <div className="flex flex-col gap-6">
        <div className="flex justify-center">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full">
            Tempo Real
          </span>
        </div>

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-2">
            <Bot className="w-10 h-10 opacity-40" />
            <p className="text-sm">Conecte-se para iniciar a conversa em tempo real.</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              'flex items-end gap-3 max-w-[80%]',
              msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start',
            )}
          >
            <Avatar className="w-8 h-8 shrink-0">
              {msg.role === 'agent' ? (
                <>
                  <AvatarImage src="https://ui-avatars.com/api/?name=Gemini+Live&background=e5e7eb&color=374151" />
                  <AvatarFallback><Bot className="w-4 h-4" /></AvatarFallback>
                </>
              ) : (
                <>
                  <AvatarImage src="https://github.com/shadcn.png" />
                  <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
                </>
              )}
            </Avatar>

            <div className="flex flex-col gap-1">
              <span className={cn(
                'text-xs font-semibold',
                msg.role === 'user' ? 'text-right' : 'text-left',
              )}>
                {msg.role === 'user' ? 'Você' : 'Gemini Live'}
              </span>

              <div className={cn(
                'p-4 rounded-2xl shadow-sm text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm',
              )}>
                {msg.content || '...'}
              </div>
            </div>
          </div>
        ))}

        {/* Invisible ref for scrolling */}
        <div ref={scrollRef} />
      </div>
    </ScrollArea>
  );
}
