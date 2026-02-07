
import { useEffect, useRef, useState } from 'react';
import { Layout } from '../components/layout/Layout';
import { ChatInterface } from '../components/voice/ChatInterface';
import { VoiceControls } from '../components/voice/VoiceControls';
import { TaskDraftCard } from '../components/voice/TaskDraftCard';
import { LiveControls } from '../components/voice/LiveControls';
import { LiveChatInterface } from '../components/voice/LiveChatInterface';
import { LiveTaskDraftCard } from '../components/voice/LiveTaskDraftCard';
import { useVoiceStore } from '../store/useVoiceStore';
import { useLiveStore } from '../store/useLiveStore';
import { AudioWaveform, Mic } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

type AgentMode = 'standard' | 'live';

export function VoiceAgentView() {
    const [mode, setMode] = useState<AgentMode>('standard');
    const { initSession } = useVoiceStore();
    const { disconnect: disconnectLive } = useLiveStore();
    const hasInitialized = useRef(false);

    useEffect(() => {
        // Initialize standard session (warmup, load greeting) on mount
        if (!hasInitialized.current) {
            initSession();
            hasInitialized.current = true;
        }
    }, [initSession]);

    // Cleanup live session when switching away from live mode
    const handleModeSwitch = (newMode: AgentMode) => {
        if (newMode === mode) return;
        if (mode === 'live') {
            disconnectLive();
        }
        setMode(newMode);
    };

    return (
        <Layout>
            <div className="flex h-full overflow-hidden">
                {/* Left Panel: Conversation & Controls */}
                <section className="flex-1 flex flex-col min-w-[400px] border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 relative">
                    {/* Header with Mode Toggle */}
                    <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center shrink-0">
                        <h3 className="text-lg font-bold tracking-tight">Conversa</h3>
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-full p-1">
                            <Button
                                variant={mode === 'standard' ? 'secondary' : 'ghost'}
                                size="sm"
                                className={cn(
                                    'h-7 rounded-full text-xs font-bold gap-1 transition-all',
                                    mode === 'standard' && 'shadow-sm',
                                )}
                                onClick={() => handleModeSwitch('standard')}
                            >
                                <Mic className="w-3 h-3" /> Padrão
                            </Button>
                            <Button
                                variant={mode === 'live' ? 'secondary' : 'ghost'}
                                size="sm"
                                className={cn(
                                    'h-7 rounded-full text-xs font-bold gap-1 transition-all',
                                    mode === 'live' && 'shadow-sm',
                                )}
                                onClick={() => handleModeSwitch('live')}
                            >
                                <AudioWaveform className="w-3 h-3" /> Tempo Real
                            </Button>
                        </div>
                    </div>

                    {/* Chat Area — conditional on mode */}
                    {mode === 'standard' ? <ChatInterface /> : <LiveChatInterface />}

                    {/* Controls — conditional on mode */}
                    {mode === 'standard' ? <VoiceControls /> : <LiveControls />}
                </section>

                {/* Right Panel: Live Draft — conditional on mode */}
                {mode === 'standard' ? <TaskDraftCard /> : <LiveTaskDraftCard />}
            </div>
        </Layout>
    );
}
