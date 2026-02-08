import { cn } from '../../lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '../ui/table';
import { Badge } from '../ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { getPriorityColor, getPriorityLabel } from '../../utils/priority';
import type { Task } from '../../types/schema';

interface ReadOnlyTaskTableProps {
    tasks: Task[];
}

export function ReadOnlyTaskTable({ tasks }: ReadOnlyTaskTableProps) {
    if (tasks.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma tarefa encontrada nesta análise.
            </p>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="overflow-y-auto max-h-[calc(100vh-420px)]">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 shadow-sm">
                        <TableRow>
                            <TableHead className="w-[25%] min-w-[200px]">Título</TableHead>
                            <TableHead className="w-[40%]">Descrição</TableHead>
                            <TableHead className="w-[15%]">Responsável</TableHead>
                            <TableHead className="w-[10%]">Prioridade</TableHead>
                            <TableHead className="w-[10%]">Vencimento</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tasks.map((task, index) => (
                            <TableRow key={index} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <TableCell className="font-medium py-3">
                                    {task.title}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm py-3">
                                    {task.description || '—'}
                                </TableCell>
                                <TableCell className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Avatar className="h-6 w-6">
                                            <AvatarImage src={`https://ui-avatars.com/api/?name=${task.assignee_name || 'NA'}&size=24`} />
                                            <AvatarFallback className="text-xs">
                                                {task.assignee_name?.charAt(0) || '?'}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="text-sm">{task.assignee_name || 'Não atribuído'}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="py-3">
                                    <Badge className={cn("pointer-events-none text-white", getPriorityColor(task.priority))}>
                                        {getPriorityLabel(task.priority)}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-sm py-3">
                                    {task.due_date || '—'}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
