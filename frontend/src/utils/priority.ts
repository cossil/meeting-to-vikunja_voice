export const getPriorityColor = (priority: number): string => {
    switch (priority) {
        case 5: return "bg-red-600 hover:bg-red-700";
        case 4: return "bg-orange-500 hover:bg-orange-600";
        case 3: return "bg-yellow-500 hover:bg-yellow-600";
        case 2: return "bg-blue-500 hover:bg-blue-600";
        default: return "bg-gray-500 hover:bg-gray-600";
    }
};

export const getPriorityLabel = (priority: number): string => {
    switch (priority) {
        case 5: return "Crítica";
        case 4: return "Urgente";
        case 3: return "Alta";
        case 2: return "Média";
        default: return "Baixa";
    }
};
