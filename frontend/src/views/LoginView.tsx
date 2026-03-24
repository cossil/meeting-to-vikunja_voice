import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Wand2 } from 'lucide-react';
import { loginRequest } from '../api/auth';
import { useAuthStore } from '../store/useAuthStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function LoginView() {
    const navigate = useNavigate();
    const login = useAuthStore((s) => s.login);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password) return;

        setLoading(true);
        setError(null);

        try {
            const data = await loginRequest(username.trim(), password);
            login(data.access_token, data.user);
            navigate('/batch', { replace: true });
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            setError(typeof detail === 'string' ? detail : 'Falha ao autenticar. Verifique suas credenciais.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-sm space-y-6"
            >
                {/* Logo + title */}
                <div className="flex flex-col items-center gap-2">
                    <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <Wand2 className="h-6 w-6" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                        MeetingToVikunja
                    </h1>
                </div>

                {/* Error banner */}
                {error && (
                    <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-2.5 text-center">
                        {error}
                    </div>
                )}

                {/* Fields */}
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label htmlFor="username" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Usuário
                        </label>
                        <Input
                            id="username"
                            type="text"
                            autoComplete="username"
                            autoFocus
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={loading}
                            placeholder="seu_usuario"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Senha
                        </label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            placeholder="••••••••"
                        />
                    </div>
                </div>

                {/* Submit */}
                <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || !username.trim() || !password}
                >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Entrar
                </Button>
            </form>
        </div>
    );
}
