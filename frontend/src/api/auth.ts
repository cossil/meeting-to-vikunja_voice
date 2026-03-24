import client from './client';
import type { LoginResponse } from '../types/schema';

/**
 * Authenticate against POST /api/v1/auth/login.
 * Returns the JWT token and user profile on success.
 */
export async function loginRequest(
    username: string,
    password: string,
): Promise<LoginResponse> {
    const response = await client.post<LoginResponse>('/auth/login', {
        username,
        password,
    });
    return response.data;
}
