import { Layout } from '../components/layout/Layout';
import { ConversationList } from '../components/conversations/ConversationList';
import { ConversationDetailPanel } from '../components/conversations/ConversationDetailPanel';

export function ConversationHistoryView() {
    return (
        <Layout>
            <div className="flex h-full">
                {/* Master: List Panel */}
                <div className="w-[380px] shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
                    <div className="h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
                        <h1 className="text-lg font-bold tracking-tight">Diálogos</h1>
                    </div>
                    <div className="flex-1 min-h-0">
                        <ConversationList />
                    </div>
                </div>

                {/* Detail Panel */}
                <div className="flex-1 min-w-0 bg-gray-50 dark:bg-gray-950">
                    <ConversationDetailPanel />
                </div>
            </div>
        </Layout>
    );
}
