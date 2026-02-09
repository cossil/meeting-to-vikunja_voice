import { useConversationStore } from '../../store/useConversationStore';
import { ScrollArea } from '../ui/scroll-area';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { cn } from '../../lib/utils';
import {
    Bot, User, MessageSquare, Loader2, AudioWaveform, Mic,
    Calendar, UserIcon, Sparkles, CheckCircle2, XCircle,
} from 'lucide-react';

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
    1: { label: 'Baixa', color: 'text-gray-500' },
    2: { label: 'Média', color: 'text-blue-500' },
    3: { label: 'Alta', color: 'text-orange-500' },
    4: { label: 'Urgente', color: 'text-red-500' },
    5: { label: 'Crítica', color: 'text-red-700' },
};

export function ConversationDetailPanel() {
    const { selectedDetail, detailLoading } = useConversationStore();

    if (detailLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!selectedDetail) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <MessageSquare className="w-12 h-12 opacity-30" />
                <p className="text-sm font-medium">Selecione um diálogo para visualizar</p>
            </div>
        );
    }

    const { transcript, task_draft, agent_type, agent_version, timestamp, synced_to_vikunja, session_id } = selectedDetail;
    const priority = PRIORITY_LABELS[task_draft.priority] || PRIORITY_LABELS[3];

    const formatDate = (ts: string) => {
        try {
            return new Date(ts).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch { return ts; }
    };

    return (
        <ScrollArea className="h-full">
            <div className="max-w-3xl mx-auto p-8 space-y-8">
                {/* Header */}
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold tracking-tight">
                            {task_draft.title || 'Diálogo sem título'}
                        </h2>
                        <Badge
                            variant="outline"
                            className={cn(
                                'text-xs font-semibold',
                                agent_type === 'live'
                                    ? 'border-violet-300 text-violet-600'
                                    : 'border-blue-300 text-blue-600',
                            )}
                        >
                            {agent_type === 'live' ? (
                                <><AudioWaveform className="w-3 h-3 mr-1" /> Tempo Real</>
                            ) : (
                                <><Mic className="w-3 h-3 mr-1" /> Padrão</>
                            )}
                        </Badge>
                        {synced_to_vikunja ? (
                            <Badge variant="outline" className="text-xs border-green-300 text-green-600 gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Sincronizado
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-xs border-gray-300 text-gray-500 gap-1">
                                <XCircle className="w-3 h-3" /> Não sincronizado
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-gray-400">
                        {formatDate(timestamp)} · {agent_version} · Sessão {session_id?.slice(0, 8)}
                    </p>
                </div>

                {/* Task Draft Card (read-only) */}
                <Card className="rounded-xl border-gray-200 dark:border-gray-800 overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            Rascunho da Tarefa
                        </h3>
                    </div>
                    <div className="p-5 grid grid-cols-2 gap-4 text-sm">
                        <div className="col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Título</span>
                            <p className="font-semibold mt-0.5">{task_draft.title || '—'}</p>
                        </div>
                        <div className="col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Descrição</span>
                            <p className="mt-0.5 text-gray-700 dark:text-gray-300">{task_draft.description || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                                <UserIcon className="w-3 h-3" /> Responsável
                            </span>
                            <p className="mt-0.5">{task_draft.assignee || 'Não atribuído'}</p>
                        </div>
                        <div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Vencimento
                            </span>
                            <p className="mt-0.5">{task_draft.due_date || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Prioridade</span>
                            <p className={cn('mt-0.5 font-medium', priority.color)}>{priority.label}</p>
                        </div>
                    </div>
                </Card>

                {/* Transcript */}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                        Transcrição ({transcript.length} mensagen{transcript.length !== 1 ? 's' : ''})
                    </h3>
                    <div className="flex flex-col gap-4">
                        {transcript.map((msg, idx) => (
                            <div
                                key={idx}
                                className={cn(
                                    'flex items-end gap-3 max-w-[85%]',
                                    msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start',
                                )}
                            >
                                <Avatar className="w-7 h-7 shrink-0">
                                    {msg.role === 'agent' ? (
                                        <>
                                            <AvatarImage src="https://ui-avatars.com/api/?name=Bot&background=e5e7eb&color=374151" />
                                            <AvatarFallback><Bot className="w-3.5 h-3.5" /></AvatarFallback>
                                        </>
                                    ) : (
                                        <>
                                            <AvatarImage src="https://github.com/shadcn.png" />
                                            <AvatarFallback><User className="w-3.5 h-3.5" /></AvatarFallback>
                                        </>
                                    )}
                                </Avatar>
                                <div className={cn(
                                    'p-3 rounded-2xl text-sm leading-relaxed',
                                    msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm',
                                )}>
                                    {msg.content || '...'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </ScrollArea>
    );
}
