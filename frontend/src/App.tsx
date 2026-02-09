import { BatchProcessingView } from './components/BatchProcessingView';
import { VoiceAgentView } from './views/VoiceAgentView';
import { SettingsView } from './views/SettingsView';
import { HistoryView } from './views/HistoryView';
import { ConversationHistoryView } from './views/ConversationHistoryView';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/batch" replace />} />
        <Route path="/batch" element={<BatchProcessingView />} />
        <Route path="/voice" element={<VoiceAgentView />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/conversations" element={<ConversationHistoryView />} />
        <Route path="/settings" element={<SettingsView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
