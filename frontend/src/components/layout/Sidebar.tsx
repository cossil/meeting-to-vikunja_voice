
import { Link, useLocation } from 'react-router-dom';
import { cn } from "@/lib/utils";
import {
    CloudUpload,
    History,
    LogOut,
    MessageSquare,
    Mic,
    Settings,
    Shield,
    Users,
    Wand2
} from 'lucide-react';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from '../../store/useAuthStore';

export function Sidebar() {
    const location = useLocation();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);

    const isActive = (path: string) => location.pathname === path;

    // Derive initials from username (first 2 chars, uppercased)
    const initials = user?.username
        ? user.username.slice(0, 2).toUpperCase()
        : '??';

    return (
        <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col justify-between shrink-0 h-screen transition-all duration-300 ease-in-out">
            <div>
                <div className="h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Wand2 className="h-5 w-5" />
                        </div>
                        <span className="font-bold text-lg tracking-tight">MeetingToVikunja</span>
                    </div>
                </div>
                <div className="p-4 flex flex-col gap-1">
                    {[
                        { icon: CloudUpload, label: 'Importar Tarefas', href: '/batch' },
                        { icon: Mic, label: 'Agente de Voz', href: '/voice' },
                        { icon: History, label: 'Histórico', href: '/history' },
                        { icon: MessageSquare, label: 'Diálogos', href: '/conversations' },
                        { icon: Settings, label: 'Configurações', href: '/settings' },
                    ].map((item) => (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors",
                                isActive(item.href)
                                    ? "bg-primary/10 text-primary"
                                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                            )}
                        >
                            <item.icon className="h-5 w-5" />
                            {item.label}
                        </Link>
                    ))}

                    {/* Admin-only link */}
                    {user?.role === 'admin' && (
                        <Link
                            to="/admin/users"
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors mt-2 border-t border-gray-100 dark:border-gray-800 pt-3",
                                isActive('/admin/users')
                                    ? "bg-primary/10 text-primary"
                                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                            )}
                        >
                            <Users className="h-5 w-5" />
                            Gestão de Usuários
                        </Link>
                    )}
                </div>
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
                <div className="flex items-center gap-3 px-3 py-2">
                    <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium truncate">{user?.username ?? '—'}</p>
                            {user?.role === 'admin' && (
                                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-bold gap-0.5 shrink-0">
                                    <Shield className="h-2.5 w-2.5" />
                                    Admin
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                <button
                    onClick={logout}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-destructive transition-colors"
                >
                    <LogOut className="h-4 w-4" />
                    Sair
                </button>
            </div>
        </aside>
    );
}
