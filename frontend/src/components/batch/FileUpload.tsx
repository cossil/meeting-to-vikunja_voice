import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useBatchStore } from '../../store/useBatchStore';
import { Button } from '../ui/button';
import { Upload, Loader2, AlertCircle, X, FileText, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

const ACCEPTED_EXTENSIONS = {
    'text/plain': ['.txt'],
    'text/markdown': ['.md'],
    'text/vtt': ['.vtt'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload() {
    const { addFiles, removeFile, clearFiles, processFiles, selectedFiles, status, error } = useBatchStore();

    const isProcessing = status === 'uploading';
    const hasFiles = selectedFiles.length > 0;
    const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            addFiles(acceptedFiles);
        }
    }, [addFiles]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ACCEPTED_EXTENSIONS,
        maxSize: MAX_FILE_SIZE,
        disabled: isProcessing,
    });

    return (
        <div className="w-full max-w-2xl mx-auto space-y-5">
            <div className="text-center space-y-1.5">
                <h2 className="text-2xl font-bold tracking-tight">Processar Reunião</h2>
                <p className="text-muted-foreground text-sm">
                    Envie um ou mais arquivos de transcrição. Múltiplos arquivos serão tratados como partes da mesma reunião.
                </p>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Erro</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Dropzone */}
            <div
                {...getRootProps()}
                className={cn(
                    "group relative flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed transition-all cursor-pointer",
                    hasFiles ? "h-28" : "h-48",
                    isDragActive
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5",
                    isProcessing && "opacity-50 pointer-events-none"
                )}
            >
                <input {...getInputProps()} />

                <div className="flex flex-col items-center justify-center gap-2">
                    <div className={cn(
                        "p-2.5 rounded-full transition-transform duration-200 group-hover:scale-110",
                        isDragActive ? "bg-primary/20" : "bg-muted"
                    )}>
                        <Upload className={cn("w-6 h-6", isDragActive ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                    </div>

                    <div className="text-center">
                        <p className="text-sm font-medium">
                            <span className="text-primary hover:underline">Clique para selecionar</span> ou arraste arquivos
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            .txt, .docx, .md, .vtt — máx. 25 MB por arquivo
                        </p>
                    </div>
                </div>
            </div>

            {/* Staged file list */}
            {hasFiles && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                            {selectedFiles.length} {selectedFiles.length === 1 ? 'arquivo selecionado' : 'arquivos selecionados'}
                            <span className="text-muted-foreground ml-1.5">({formatSize(totalSize)})</span>
                        </p>
                        {!isProcessing && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearFiles}>
                                Limpar tudo
                            </Button>
                        )}
                    </div>

                    <div className="rounded-lg border divide-y max-h-52 overflow-y-auto">
                        {selectedFiles.map((file, idx) => (
                            <div key={`${file.name}-${idx}`} className="flex items-center gap-3 px-3 py-2 group">
                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                                </div>
                                {!isProcessing && (
                                    <button
                                        type="button"
                                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                                        onClick={() => removeFile(idx)}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {selectedFiles.length > 1 && (
                        <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                            <p className="text-xs text-primary font-medium">
                                ✦ Contexto combinado — {selectedFiles.length} arquivos serão analisados como uma reunião contínua.
                            </p>
                        </div>
                    )}

                    <Button
                        className="w-full gap-2"
                        size="lg"
                        onClick={processFiles}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Analisando {selectedFiles.length} {selectedFiles.length === 1 ? 'arquivo' : 'arquivos'}...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4" />
                                Processar {selectedFiles.length} {selectedFiles.length === 1 ? 'arquivo' : 'arquivos'}
                            </>
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
}
