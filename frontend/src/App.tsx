import { BatchProcessingView } from './components/BatchProcessingView';
import { VoiceAgentView } from './views/VoiceAgentView';
import { SettingsView } from './views/SettingsView';
import { HistoryView } from './views/HistoryView';
import { ConversationHistoryView } from './views/ConversationHistoryView';
import { LoginView } from './views/LoginView';
import { UserManagementView } from './views/UserManagementView';
import { ProtectedRoute } from './components/ProtectedRoute';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public route */}
        <Route path="/login" element={<LoginView />} />

        {/* Protected routes */}
        <Route path="/" element={<Navigate to="/batch" replace />} />
        <Route path="/batch" element={<ProtectedRoute><BatchProcessingView /></ProtectedRoute>} />
        <Route path="/voice" element={<ProtectedRoute><VoiceAgentView /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><HistoryView /></ProtectedRoute>} />
        <Route path="/conversations" element={<ProtectedRoute><ConversationHistoryView /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsView /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute requireAdmin={true}><UserManagementView /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
