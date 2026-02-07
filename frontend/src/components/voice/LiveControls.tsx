import { useLiveStore } from '../../store/useLiveStore';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Zap, Loader2, PhoneOff, Mic, Volume2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * LiveControls — Dedicated control panel for the Live Voice Agent.
 *
 * Renders:
 *   - Connect/Disconnect toggle button
 *   - Connection status indicator
 *   - Mic (user) and Speaker (model) volume visualizers
 *   - Error display
 *
 * Imports exclusively from useLiveStore. Does NOT touch useVoiceStore.
 */
export function LiveControls() {
  const {
    connectionState,
    isStreaming,
    isModelSpeaking,
    userVolume,
    modelVolume,
    error,
    connect,
    disconnect,
  } = useLiveStore();

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  // --- Status text & badge variant ---
  const statusConfig = (() => {
    if (connectionState === 'error') return { text: 'Erro', variant: 'destructive' as const, dot: 'bg-red-500' };
    if (isConnecting) return { text: 'A ligar...', variant: 'outline' as const, dot: 'bg-yellow-500 animate-pulse' };
    if (isModelSpeaking) return { text: 'A falar...', variant: 'default' as const, dot: 'bg-blue-500 animate-pulse' };
    if (isStreaming) return { text: 'A ouvir...', variant: 'default' as const, dot: 'bg-green-500 animate-pulse' };
    if (isConnected) return { text: 'Conectado', variant: 'secondary' as const, dot: 'bg-green-500' };
    return { text: 'Pronto', variant: 'outline' as const, dot: 'bg-gray-400' };
  })();

  return (
    <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950/95 backdrop-blur-sm z-10">
      <div className="flex flex-col items-center gap-5">
        {/* Error Banner */}
        {error && (
          <div className="w-full flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Volume Visualizers — only visible when connected */}
        {isConnected && (
          <div className="w-full max-w-xs space-y-3">
            {/* User Mic Volume */}
            <div className="flex items-center gap-3">
              <Mic className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-75"
                  style={{ width: `${Math.min(userVolume * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-gray-400 w-8 text-right">
                {Math.round(userVolume * 100)}%
              </span>
            </div>

            {/* Model Speaker Volume */}
            <div className="flex items-center gap-3">
              <Volume2 className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-75"
                  style={{ width: `${Math.min(modelVolume * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-gray-400 w-8 text-right">
                {Math.round(modelVolume * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* Main Toggle Button */}
        <div className="relative group cursor-pointer">
          {isConnected && (
            <div className="absolute inset-0 bg-green-500/15 rounded-full animate-ping pointer-events-none" />
          )}
          <Button
            size="lg"
            variant={isConnected ? 'destructive' : 'default'}
            className={cn(
              'relative flex items-center justify-center gap-2 rounded-full px-8 h-14 text-base font-semibold shadow-lg transition-all hover:scale-105',
              isConnecting && 'opacity-80 cursor-wait',
            )}
            onClick={isConnected ? disconnect : connect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                A ligar...
              </>
            ) : isConnected ? (
              <>
                <PhoneOff className="w-5 h-5" />
                Desconectar
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Conectar ao Gemini Live
              </>
            )}
          </Button>
        </div>

        {/* Status Badge */}
        <Badge
          variant={statusConfig.variant}
          className="gap-1.5 px-3 py-1"
        >
          <span className={cn('w-2 h-2 rounded-full', statusConfig.dot)} />
          {statusConfig.text}
        </Badge>
      </div>
    </div>
  );
}
