import client from './client';
import type { UserPublic, UserCreate, UserUpdate, PasswordReset } from '../types/schema';

const BASE = '/admin/users';

export async function fetchUsers(): Promise<UserPublic[]> {
    const res = await client.get<UserPublic[]>(BASE);
    return res.data;
}

export async function createUser(payload: UserCreate): Promise<UserPublic> {
    const res = await client.post<UserPublic>(BASE, payload);
    return res.data;
}

export async function updateUser(userId: string, payload: UserUpdate): Promise<UserPublic> {
    const res = await client.put<UserPublic>(`${BASE}/${userId}`, payload);
    return res.data;
}

export async function deleteUser(userId: string): Promise<void> {
    await client.delete(`${BASE}/${userId}`);
}

export async function resetPassword(userId: string, payload: PasswordReset): Promise<void> {
    await client.post(`${BASE}/${userId}/reset-password`, payload);
}
