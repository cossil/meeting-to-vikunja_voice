import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchGlossary, saveGlossary, type GlossaryData } from '../../api/glossary';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Plus, Trash2, Save, Loader2, BookOpen, X, Pencil, Check } from 'lucide-react';

type FormMode = 'add' | 'edit';

interface FormState {
    mode: FormMode;
    term: string;
    variations: string[];
    variationInput: string;
    /** Original key when editing — needed to handle renames */
    originalTerm: string | null;
}

const EMPTY_FORM: FormState = {
    mode: 'add',
    term: '',
    variations: [],
    variationInput: '',
    originalTerm: null,
};

// --- Tag Input sub-component ------------------------------------------------

function TagInput({
    tags,
    inputValue,
    onInputChange,
    onAddTag,
    onRemoveTag,
    placeholder,
}: {
    tags: string[];
    inputValue: string;
    onInputChange: (v: string) => void;
    onAddTag: (tag: string) => void;
    onRemoveTag: (idx: number) => void;
    placeholder?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    const commitTag = () => {
        const raw = inputValue.trim();
        if (!raw) return;
        // Support comma-separated paste
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        parts.forEach(onAddTag);
        onInputChange('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitTag();
        }
        // Backspace on empty input removes last tag
        if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
            onRemoveTag(tags.length - 1);
        }
    };

    return (
        <div
            className="flex flex-wrap items-center gap-1.5 min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-text"
            onClick={() => inputRef.current?.focus()}
        >
            {tags.map((tag, idx) => (
                <Badge
                    key={`tag-${idx}`}
                    variant="secondary"
                    className="gap-1 pr-1 shrink-0"
                >
                    {tag}
                    <button
                        type="button"
                        className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors p-0.5"
                        onClick={(e) => { e.stopPropagation(); onRemoveTag(idx); }}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </Badge>
            ))}
            <input
                ref={inputRef}
                className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
                placeholder={tags.length === 0 ? placeholder : ''}
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitTag}
            />
        </div>
    );
}

// --- Main component ---------------------------------------------------------

export function GlossaryEditor() {
    const [glossary, setGlossary] = useState<GlossaryData>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [workingCopy, setWorkingCopy] = useState<GlossaryData>({});
    const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });

    const termInputRef = useRef<HTMLInputElement>(null);

    const loadGlossary = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchGlossary();
            setGlossary(data);
            setWorkingCopy(data);
            setHasChanges(false);
        } catch (err) {
            setError('Falha ao carregar glossário. Verifique se o backend está rodando.');
            console.error('Failed to load glossary:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadGlossary();
    }, [loadGlossary]);

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            const updated = await saveGlossary(workingCopy);
            setGlossary(updated);
            setWorkingCopy(updated);
            setHasChanges(false);
        } catch (err) {
            setError('Falha ao salvar glossário.');
            console.error('Failed to save glossary:', err);
        } finally {
            setSaving(false);
        }
    };

    // --- Form actions --------------------------------------------------------

    const handleFormSubmit = () => {
        const term = form.term.trim();
        if (!term || form.variations.length === 0) return;

        setWorkingCopy((prev) => {
            const next = { ...prev };
            // If editing and the term was renamed, remove the old key
            if (form.mode === 'edit' && form.originalTerm && form.originalTerm !== term) {
                delete next[form.originalTerm];
            }
            next[term] = [...form.variations];
            return next;
        });
        setForm({ ...EMPTY_FORM });
        setHasChanges(true);
    };

    const handleStartEdit = (term: string) => {
        setForm({
            mode: 'edit',
            term,
            variations: [...(workingCopy[term] || [])],
            variationInput: '',
            originalTerm: term,
        });
        // Focus the term input after state update
        setTimeout(() => termInputRef.current?.focus(), 50);
    };

    const handleCancelForm = () => {
        setForm({ ...EMPTY_FORM });
    };

    const handleAddFormTag = (tag: string) => {
        if (form.variations.includes(tag)) return; // prevent duplicates
        setForm((f) => ({ ...f, variations: [...f.variations, tag] }));
    };

    const handleRemoveFormTag = (idx: number) => {
        setForm((f) => {
            const next = [...f.variations];
            next.splice(idx, 1);
            return { ...f, variations: next };
        });
    };

    // --- Table actions -------------------------------------------------------

    const handleDeleteTerm = (term: string) => {
        setWorkingCopy((prev) => {
            const next = { ...prev };
            delete next[term];
            return next;
        });
        // If we're editing this term, cancel the edit
        if (form.originalTerm === term) setForm({ ...EMPTY_FORM });
        setHasChanges(true);
    };

    const handleRemoveVariation = (term: string, variationIndex: number) => {
        setWorkingCopy((prev) => {
            const variations = [...(prev[term] || [])];
            variations.splice(variationIndex, 1);
            if (variations.length === 0) {
                const next = { ...prev };
                delete next[term];
                return next;
            }
            return { ...prev, [term]: variations };
        });
        setHasChanges(true);
    };

    const handleDiscard = () => {
        setWorkingCopy(glossary);
        setHasChanges(false);
        setForm({ ...EMPTY_FORM });
    };

    const handleTermKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleFormSubmit();
        }
    };

    const isFormValid = form.term.trim().length > 0 && form.variations.length > 0;
    const isEditing = form.mode === 'edit';

    const sortedTerms = Object.keys(workingCopy).sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    if (loading) {
        return (
            <Card className="border-0 shadow-none">
                <CardContent className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-3 text-muted-foreground">Carregando glossário...</span>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-0 shadow-none flex flex-col h-full">
            <CardHeader className="pb-4 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <BookOpen className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Glossário Fonético</CardTitle>
                            <CardDescription>
                                Regras de correção para nomes e termos técnicos reconhecidos por voz.
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasChanges && (
                            <Button variant="ghost" size="sm" onClick={handleDiscard}>
                                Descartar
                            </Button>
                        )}
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={!hasChanges || saving}
                            className="gap-1.5"
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4" />
                            )}
                            Salvar
                        </Button>
                    </div>
                </div>

                {error && (
                    <div className="mt-3 rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-2.5">
                        {error}
                    </div>
                )}

                {/* Add / Edit term form */}
                <div className={`mt-4 rounded-lg border p-4 space-y-3 transition-colors ${isEditing ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                            {isEditing ? 'Editar Termo' : 'Adicionar Termo'}
                        </span>
                        {isEditing && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelForm}>
                                Cancelar Edição
                            </Button>
                        )}
                    </div>
                    <div className="flex items-end gap-3">
                        <div className="w-[200px] shrink-0 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Termo Correto</label>
                            <Input
                                ref={termInputRef}
                                placeholder="Ex: Roquelina"
                                value={form.term}
                                onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                                onKeyDown={handleTermKeyDown}
                            />
                        </div>
                        <div className="flex-1 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                                Variações (Enter ou vírgula para adicionar)
                            </label>
                            <TagInput
                                tags={form.variations}
                                inputValue={form.variationInput}
                                onInputChange={(v) => setForm((f) => ({ ...f, variationInput: v }))}
                                onAddTag={handleAddFormTag}
                                onRemoveTag={handleRemoveFormTag}
                                placeholder="Ex: Rock, Roque, Roc..."
                            />
                        </div>
                        <Button
                            size="icon"
                            variant={isEditing ? 'default' : 'secondary'}
                            onClick={handleFormSubmit}
                            disabled={!isFormValid}
                            className="shrink-0"
                        >
                            {isEditing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 min-h-0 px-6 pb-6">
                <ScrollArea className="h-full rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30">
                                <TableHead className="w-[200px] font-semibold">Termo Correto</TableHead>
                                <TableHead className="font-semibold">Variações Reconhecidas</TableHead>
                                <TableHead className="w-[90px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedTerms.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                                        Nenhum termo cadastrado. Adicione o primeiro acima.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedTerms.map((term) => {
                                    const isBeingEdited = isEditing && form.originalTerm === term;
                                    return (
                                        <TableRow
                                            key={term}
                                            className={`group ${isBeingEdited ? 'bg-primary/5' : ''}`}
                                        >
                                            <TableCell className="font-medium text-primary">{term}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {workingCopy[term].map((variation, idx) => (
                                                        <Badge
                                                            key={`${term}-${idx}`}
                                                            variant="secondary"
                                                            className="gap-1 pr-1 hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                                                            onClick={() => handleRemoveVariation(term, idx)}
                                                        >
                                                            {variation}
                                                            <X className="h-3 w-3" />
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-0.5">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                                                        onClick={() => handleStartEdit(term)}
                                                        title="Editar termo"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleDeleteTerm(term)}
                                                        title="Excluir termo"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
