import client from './client';

export type GlossaryData = Record<string, string[]>;

export async function fetchGlossary(): Promise<GlossaryData> {
    const response = await client.get<GlossaryData>('/glossary');
    return response.data;
}

export async function saveGlossary(data: GlossaryData): Promise<GlossaryData> {
    const response = await client.post<GlossaryData>('/glossary', { data });
    return response.data;
}

export async function addGlossaryTerm(term: string, variations: string[]): Promise<GlossaryData> {
    const response = await client.post<GlossaryData>('/glossary/term', { term, variations });
    return response.data;
}

export async function deleteGlossaryTerm(term: string): Promise<GlossaryData> {
    const response = await client.delete<GlossaryData>('/glossary/term', { data: { term } });
    return response.data;
}
