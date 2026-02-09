import { useEffect, useMemo } from 'react';
import { useConversationStore } from '../../store/useConversationStore';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Search, MessageSquare, Mic, AudioWaveform, CheckCircle2, Loader2 } from 'lucide-react';

export function ConversationList() {
    const {
        items, status, error, searchQuery, filterAgent, selectedDetail,
        fetchList, fetchDetail, setSearchQuery, setFilterAgent,
    } = useConversationStore();

    useEffect(() => {
        fetchList();
    }, [fetchList]);

    const filtered = useMemo(() => {
        let result = items;
        if (filterAgent !== 'all') {
            result = result.filter(i => i.agent_type === filterAgent);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(i =>
                (i.task_title?.toLowerCase().includes(q)) ||
                i.id.toLowerCase().includes(q)
            );
        }
        return result;
    }, [items, filterAgent, searchQuery]);

    const formatDate = (ts: string) => {
        try {
            const d = new Date(ts);
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return ts; }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Search + Filter */}
            <div className="p-4 space-y-3 border-b border-gray-100 dark:border-gray-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar diálogos..."
                        className="pl-9 h-9 text-sm"
                    />
                </div>
                <div className="flex gap-1">
                    {(['all', 'standard', 'live'] as const).map((f) => (
                        <Button
                            key={f}
                            variant={filterAgent === f ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 text-xs font-medium rounded-full"
                            onClick={() => setFilterAgent(f)}
                        >
                            {f === 'all' ? 'Todos' : f === 'standard' ? 'Padrão' : 'Tempo Real'}
                        </Button>
                    ))}
                </div>
            </div>

            {/* List */}
            <ScrollArea className="flex-1">
                {status === 'loading' && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-4 text-sm text-red-500">{error}</div>
                )}

                {status === 'idle' && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
                        <MessageSquare className="w-8 h-8 opacity-40" />
                        <p className="text-sm">Nenhum diálogo encontrado.</p>
                    </div>
                )}

                {filtered.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => fetchDetail(item.id)}
                        className={cn(
                            'w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors',
                            selectedDetail?.id === item.id && 'bg-primary/5 border-l-2 border-l-primary',
                        )}
                    >
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400 font-medium">
                                {formatDate(item.timestamp)}
                            </span>
                            <div className="flex items-center gap-1.5">
                                {item.synced_to_vikunja && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                )}
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        'text-[10px] px-1.5 py-0 h-5 font-semibold',
                                        item.agent_type === 'live'
                                            ? 'border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400'
                                            : 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400',
                                    )}
                                >
                                    {item.agent_type === 'live' ? (
                                        <><AudioWaveform className="w-3 h-3 mr-0.5" /> Live</>
                                    ) : (
                                        <><Mic className="w-3 h-3 mr-0.5" /> Padrão</>
                                    )}
                                </Badge>
                            </div>
                        </div>
                        <p className="text-sm font-medium truncate text-gray-800 dark:text-gray-200">
                            {item.task_title || 'Sem título'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {item.turn_count} mensagen{item.turn_count !== 1 ? 's' : ''}
                        </p>
                    </button>
                ))}
            </ScrollArea>
        </div>
    );
}
