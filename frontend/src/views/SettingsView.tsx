import { Layout } from '../components/layout/Layout';
import { GlossaryEditor } from '../components/glossary/GlossaryEditor';

export function SettingsView() {
    return (
        <Layout>
            <div className="flex flex-col h-full overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
                    <h2 className="text-lg font-bold tracking-tight">Definições</h2>
                    <p className="text-sm text-muted-foreground">
                        Gerencie as configurações do sistema.
                    </p>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                    <GlossaryEditor />
                </div>
            </div>
        </Layout>
    );
}
