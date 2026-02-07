import React, { useState, useEffect, useRef } from 'react';
import { GeminiLiveClient } from './services/geminiLiveClient';
import { ConnectionState, TranscriptItem } from './types';
import Waveform from './components/Waveform';

// Define a unique ID generator
const generateId = () => Math.random().toString(36).substring(2, 9);

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [userVolume, setUserVolume] = useState(0);
  const [modelVolume, setModelVolume] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  // Singleton reference for the client
  const clientRef = useRef<GeminiLiveClient | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

  const handleConnect = async () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) return;

    setConnectionState(ConnectionState.CONNECTING);
    
    try {
      clientRef.current = new GeminiLiveClient();
      
      clientRef.current.onClose = () => {
        setConnectionState(ConnectionState.DISCONNECTED);
      };

      clientRef.current.onVolume = (vol, source) => {
        if (source === 'user') setUserVolume(vol);
        if (source === 'model') setModelVolume(vol);
      };

      clientRef.current.onTranscript = (text, source, isComplete) => {
         setTranscripts(prev => {
            const existingIndex = prev.findIndex(t => t.id === `${source}-current`);
            
            // If it's a new partial or update
            if (existingIndex >= 0) {
                const newArr = [...prev];
                newArr[existingIndex] = { ...newArr[existingIndex], text, isComplete };
                // If complete, rename ID so next partial creates new entry
                if (isComplete) {
                   newArr[existingIndex].id = generateId();
                }
                return newArr;
            } else {
                // Create new partial
                return [...prev, {
                    id: `${source}-current`,
                    source,
                    text,
                    isComplete
                }];
            }
         });
      };

      await clientRef.current.connect();
      setConnectionState(ConnectionState.CONNECTED);
    } catch (error) {
      console.error(error);
      setConnectionState(ConnectionState.ERROR);
      clientRef.current?.disconnect();
    }
  };

  const handleDisconnect = () => {
    clientRef.current?.disconnect();
    setConnectionState(ConnectionState.DISCONNECTED);
    setUserVolume(0);
    setModelVolume(0);
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-teal-50 to-orange-50">
      {/* Header */}
      <header className="flex-none bg-white shadow-sm px-6 py-4 flex items-center justify-between z-10 border-b border-teal-100">
        <div className="flex items-center gap-3">
           <div className="bg-teal-600 p-2 rounded-lg text-white">
             {/* Palm Tree Icon SVG */}
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
             </svg>
           </div>
           <div>
             <h1 className="text-xl font-bold text-slate-800 tracking-tight">Sunshine Palms Resort</h1>
             <p className="text-xs text-teal-600 font-medium uppercase tracking-wider">Reception Desk</p>
           </div>
        </div>
        <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
            <span className="text-sm font-medium text-slate-500">
                {connectionState === ConnectionState.CONNECTED ? 'Online' : 'Offline'}
            </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Left Panel: Avatar & Visualizer */}
        <div className="flex-none md:w-96 bg-white/50 backdrop-blur-sm border-r border-teal-100 p-6 flex flex-col items-center justify-center gap-8 transition-all">
            
            {/* Avatar Card */}
            <div className="relative group">
                <div className={`absolute -inset-1 bg-gradient-to-r from-teal-400 to-orange-400 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200 ${connectionState === ConnectionState.CONNECTED ? 'opacity-50' : 'opacity-10'}`}></div>
                <div className="relative h-48 w-48 bg-slate-100 rounded-full overflow-hidden border-4 border-white shadow-xl">
                    <img 
                        src="https://picsum.photos/seed/receptionist/400/400" 
                        alt="Receptionist Avatar" 
                        className="h-full w-full object-cover"
                    />
                </div>
                {/* Speaking Indicator */}
                <div className={`absolute bottom-2 right-2 bg-white p-1.5 rounded-full shadow-lg transition-opacity duration-300 ${modelVolume > 0.05 ? 'opacity-100' : 'opacity-0'}`}>
                    <Waveform active={true} level={modelVolume} color="bg-teal-500" />
                </div>
            </div>

            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-slate-800">Sarah</h2>
                <p className="text-slate-500 max-w-[200px]">
                    Your concierge for checking in, reservations, and local tips.
                </p>
            </div>

            {/* Controls */}
            <div className="w-full max-w-xs space-y-4">
                {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
                    <button 
                        onClick={handleConnect}
                        disabled={connectionState === ConnectionState.CONNECTING}
                        className="w-full py-4 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold shadow-lg shadow-teal-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70"
                    >
                        {connectionState === ConnectionState.CONNECTING ? (
                            <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></span>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                            </svg>
                        )}
                        Start Conversation
                    </button>
                ) : (
                    <button 
                        onClick={handleDisconnect}
                        className="w-full py-4 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-semibold transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                        End Call
                    </button>
                )}
                
                {/* Mic Status */}
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                    <div className={`p-2 rounded-full ${userVolume > 0.05 ? 'bg-teal-100 text-teal-600' : 'bg-slate-100'}`}>
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <span>{userVolume > 0.05 ? 'Listening...' : 'Microphone ready'}</span>
                </div>
            </div>

        </div>

        {/* Right Panel: Chat Transcript */}
        <div className="flex-1 bg-white relative flex flex-col">
            <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none"></div>
            
            <div className="p-4 border-b border-slate-100 bg-white/80 backdrop-blur z-10">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Live Transcript</h3>
            </div>

            <div 
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
            >
                {transcripts.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-400 italic">
                        Conversation will appear here...
                    </div>
                )}
                
                {transcripts.map((item) => (
                    <div 
                        key={item.id} 
                        className={`flex w-full ${item.source === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed ${
                            item.source === 'user' 
                                ? 'bg-teal-600 text-white rounded-tr-none' 
                                : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
                        }`}>
                            <p>{item.text}</p>
                            {!item.isComplete && (
                                <span className="inline-block w-1 h-1 bg-current rounded-full ml-1 animate-bounce"/>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {connectionState === ConnectionState.CONNECTED && (
                <div className="p-4 bg-slate-50 border-t border-slate-100 text-xs text-center text-slate-400">
                    AI is active and listening. Speak naturally.
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;