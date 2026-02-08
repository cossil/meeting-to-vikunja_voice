import { useHistoryStore } from '../../store/useHistoryStore';
import { ReadOnlyTaskTable } from './ReadOnlyTaskTable';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Loader2, Clock, FileText, Cpu, Zap, Hash } from 'lucide-react';

export function HistoryDetailPanel() {
    const { selectedDetail, detailLoading } = useHistoryStore();

    if (detailLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!selectedDetail) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="size-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                    <FileText className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <p className="text-muted-foreground text-sm">
                    Selecione uma análise para visualizar os detalhes.
                </p>
            </div>
        );
    }

    const formatDate = (iso: string) => {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return iso;
        }
    };

    const { analysis, ...meta } = selectedDetail;

    return (
        <div className="flex flex-col h-full overflow-y-auto p-6 gap-5">
            {/* Metadata Card */}
            <Card className="shrink-0">
                <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-semibold tracking-tight">
                                {meta.source_files.length > 1
                                    ? `${meta.file_count} arquivos combinados`
                                    : meta.source_files[0] || 'Arquivo desconhecido'
                                }
                            </h2>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {formatDate(meta.timestamp)}
                            </p>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                            {analysis.tasks.length} {analysis.tasks.length === 1 ? 'tarefa' : 'tarefas'}
                        </Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <MetaStat icon={Cpu} label="Modelo" value={meta.model_used} />
                        <MetaStat icon={Hash} label="Tokens" value={meta.token_count.toLocaleString('pt-BR')} />
                        <MetaStat icon={Zap} label="Tempo" value={`${meta.processing_time.toFixed(1)}s`} />
                        <MetaStat icon={Clock} label="Arquivos" value={meta.file_count.toString()} />
                    </div>

                    {meta.source_files.length > 1 && (
                        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Arquivos fonte:</p>
                            <div className="flex flex-wrap gap-1.5">
                                {meta.source_files.map((f, i) => (
                                    <Badge key={i} variant="outline" className="text-xs font-normal">
                                        {f}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Tasks Table */}
            <div className="flex-1 min-h-0">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Tarefas Extraídas
                </h3>
                <ReadOnlyTaskTable tasks={analysis.tasks} />
            </div>
        </div>
    );
}

function MetaStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-medium truncate">{value}</p>
            </div>
        </div>
    );
}
