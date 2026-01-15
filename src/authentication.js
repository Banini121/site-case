import { verifyAccessToken } from './security.js';

export async function getAccessPayload(request) {
  const token = request.cookies.access_token;
  if (!token) return null;
  try {
    return await verifyAccessToken(token);
  } catch (error) {
    return null;
  }
}
