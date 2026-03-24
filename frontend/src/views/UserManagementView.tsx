import { useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/layout/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import {
    Table, TableBody, TableCell, TableHead,
    TableHeader, TableRow,
} from '../components/ui/table';
import {
    Select, SelectContent, SelectItem,
    SelectTrigger, SelectValue,
} from '../components/ui/select';
import {
    KeyRound, Loader2, PencilLine, Plus,
    Shield, ToggleLeft, Trash2, UserCog, Users, X,
} from 'lucide-react';
import { fetchUsers, createUser, updateUser, deleteUser, resetPassword } from '../api/admin';
import type { UserPublic } from '../types/schema';

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

function Modal({ open, onClose, title, children }: {
    open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                    <h2 className="text-base font-semibold">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="px-6 py-5">{children}</div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function UserManagementView() {
    const [users, setUsers] = useState<UserPublic[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Create user modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'user' as 'admin' | 'user' });
    const [createLoading, setCreateLoading] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Edit modal
    const [editTarget, setEditTarget] = useState<UserPublic | null>(null);
    const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
    const [editLoading, setEditLoading] = useState(false);

    // Reset password modal
    const [resetTarget, setResetTarget] = useState<UserPublic | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);

    // Confirm delete
    const [deleteTarget, setDeleteTarget] = useState<UserPublic | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setUsers(await fetchUsers());
        } catch {
            setError('Falha ao carregar usuários.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ---- Create ----
    const handleCreate = async () => {
        if (!createForm.username.trim() || !createForm.password) return;
        setCreateLoading(true);
        setCreateError(null);
        try {
            await createUser({
                username: createForm.username.trim(),
                password: createForm.password,
                role: createForm.role,
            });
            setShowCreate(false);
            setCreateForm({ username: '', password: '', role: 'user' });
            await load();
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            setCreateError(typeof detail === 'string' ? detail : 'Erro ao criar usuário.');
        } finally {
            setCreateLoading(false);
        }
    };

    // ---- Edit (role) ----
    const openEdit = (u: UserPublic) => { setEditTarget(u); setEditRole(u.role); };
    const handleEdit = async () => {
        if (!editTarget) return;
        setEditLoading(true);
        try {
            await updateUser(editTarget.id, { role: editRole });
            setEditTarget(null);
            await load();
        } catch { /* swallow — table will still show old data */ }
        finally { setEditLoading(false); }
    };

    // ---- Toggle active ----
    const handleToggle = async (u: UserPublic) => {
        try {
            await updateUser(u.id, { is_active: !u.is_active });
            await load();
        } catch { /* no-op */ }
    };

    // ---- Delete ----
    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleteLoading(true);
        try {
            await deleteUser(deleteTarget.id);
            setDeleteTarget(null);
            await load();
        } catch { /* no-op */ }
        finally { setDeleteLoading(false); }
    };

    // ---- Reset password ----
    const handleReset = async () => {
        if (!resetTarget || newPassword.length < 8) return;
        setResetLoading(true);
        setResetError(null);
        try {
            await resetPassword(resetTarget.id, { new_password: newPassword });
            setResetTarget(null);
            setNewPassword('');
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            setResetError(typeof detail === 'string' ? detail : 'Erro ao redefinir senha.');
        } finally {
            setResetLoading(false);
        }
    };

    return (
        <Layout>
            <div className="flex flex-col h-full">
                {/* Header */}
                <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Users className="h-5 w-5 text-primary" />
                        <h1 className="text-lg font-bold tracking-tight">Gestão de Usuários</h1>
                        <Badge variant="secondary" className="ml-1 text-[10px]">{users.length}</Badge>
                    </div>
                    <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
                        <Plus className="h-4 w-4" />
                        Novo Usuário
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : error ? (
                        <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-3 text-center">
                            {error}
                        </div>
                    ) : users.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                            <UserCog className="h-10 w-10" />
                            <p className="text-sm">Nenhum usuário encontrado.</p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50 dark:bg-gray-800/50">
                                        <TableHead>Usuário</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Criado em</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {users.map((u) => (
                                        <TableRow key={u.id}>
                                            <TableCell className="font-medium">{u.username}</TableCell>
                                            <TableCell>
                                                {u.role === 'admin' ? (
                                                    <Badge variant="default" className="gap-1">
                                                        <Shield className="h-3 w-3" /> Admin
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary">Usuário</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {u.is_active ? (
                                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ativo
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Inativo
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs">
                                                {new Date(u.created_at).toLocaleDateString('pt-BR')}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="Editar role">
                                                        <PencilLine className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleToggle(u)} title={u.is_active ? 'Desativar' : 'Ativar'}>
                                                        <ToggleLeft className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => { setResetTarget(u); setNewPassword(''); setResetError(null); }} title="Redefinir senha">
                                                        <KeyRound className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(u)} title="Excluir">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </div>

            {/* ========== CREATE MODAL ========== */}
            <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateError(null); }} title="Novo Usuário">
                <div className="space-y-4">
                    {createError && (
                        <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-2.5">{createError}</div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Usuário</label>
                        <Input
                            value={createForm.username}
                            onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
                            placeholder="nome_usuario"
                            disabled={createLoading}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Senha</label>
                        <Input
                            type="password"
                            value={createForm.password}
                            onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                            placeholder="Mínimo 8 caracteres"
                            disabled={createLoading}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Role</label>
                        <Select value={createForm.role} onValueChange={(v) => setCreateForm(f => ({ ...f, role: v as 'admin' | 'user' }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">Usuário</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => { setShowCreate(false); setCreateError(null); }} disabled={createLoading}>
                            Cancelar
                        </Button>
                        <Button size="sm" onClick={handleCreate} disabled={createLoading || !createForm.username.trim() || createForm.password.length < 8}>
                            {createLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Criar
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ========== EDIT ROLE MODAL ========== */}
            <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Editar Role — ${editTarget?.username ?? ''}`}>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Role</label>
                        <Select value={editRole} onValueChange={(v) => setEditRole(v as 'admin' | 'user')}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">Usuário</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setEditTarget(null)} disabled={editLoading}>Cancelar</Button>
                        <Button size="sm" onClick={handleEdit} disabled={editLoading}>
                            {editLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salvar
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ========== RESET PASSWORD MODAL ========== */}
            <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Redefinir Senha — ${resetTarget?.username ?? ''}`}>
                <div className="space-y-4">
                    {resetError && (
                        <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-2.5">{resetError}</div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Nova Senha</label>
                        <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Mínimo 8 caracteres"
                            disabled={resetLoading}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setResetTarget(null)} disabled={resetLoading}>Cancelar</Button>
                        <Button size="sm" onClick={handleReset} disabled={resetLoading || newPassword.length < 8}>
                            {resetLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Redefinir
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ========== DELETE CONFIRM MODAL ========== */}
            <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Confirmar Exclusão">
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Tem certeza que deseja excluir o usuário <strong className="text-foreground">{deleteTarget?.username}</strong>?
                        Esta ação é irreversível.
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>Cancelar</Button>
                        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteLoading}>
                            {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Excluir
                        </Button>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
}
