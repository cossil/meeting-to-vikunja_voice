import { useEffect } from 'react';
import { useHistoryStore } from '../../store/useHistoryStore';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { FileText, Files, Search, Loader2, AlertCircle } from 'lucide-react';
import type { HistorySummary } from '../../types/schema';

export function HistoryList() {
    const {
        items,
        status,
        error,
        searchQuery,
        selectedDetail,
        fetchList,
        fetchDetail,
        setSearchQuery,
    } = useHistoryStore();

    useEffect(() => {
        fetchList();
    }, [fetchList]);

    const filtered = items.filter((item) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            item.id.toLowerCase().includes(q) ||
            item.source_files.some((f) => f.toLowerCase().includes(q)) ||
            item.timestamp.toLowerCase().includes(q)
        );
    });

    const formatDate = (iso: string) => {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return iso;
        }
    };

    const getDisplayName = (item: HistorySummary) => {
        if (item.file_count > 1) return `${item.file_count} arquivos combinados`;
        return item.source_files[0] || 'Arquivo desconhecido';
    };

    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive px-4">
                <AlertCircle className="h-6 w-6" />
                <p className="text-sm text-center">{error}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por arquivo..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9"
                    />
                </div>
            </div>

            <ScrollArea className="flex-1">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                        <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
                        <p className="text-sm text-muted-foreground">
                            {searchQuery
                                ? `Nenhum resultado para "${searchQuery}"`
                                : 'Nenhuma análise encontrada'}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {filtered.map((item) => {
                            const isActive = selectedDetail?.id === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => fetchDetail(item.id)}
                                    className={cn(
                                        "flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 dark:border-gray-800/50",
                                        isActive
                                            ? "bg-primary/5 border-l-2 border-l-primary"
                                            : "hover:bg-gray-50 dark:hover:bg-gray-800/30 border-l-2 border-l-transparent"
                                    )}
                                >
                                    <div className={cn(
                                        "mt-0.5 shrink-0 rounded-lg p-2",
                                        isActive
                                            ? "bg-primary/10 text-primary"
                                            : "bg-gray-100 dark:bg-gray-800 text-muted-foreground"
                                    )}>
                                        {item.file_count > 1
                                            ? <Files className="h-4 w-4" />
                                            : <FileText className="h-4 w-4" />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={cn(
                                            "text-sm font-medium truncate",
                                            isActive && "text-primary"
                                        )}>
                                            {getDisplayName(item)}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(item.timestamp)}
                                            </span>
                                            <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                                {item.task_count} {item.task_count === 1 ? 'tarefa' : 'tarefas'}
                                            </Badge>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
