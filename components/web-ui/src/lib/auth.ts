import { SignJWT, jwtVerify } from 'jose';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(encoder.encode(secret));
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const encoder = new TextEncoder();
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return {
    userId: payload.userId as number,
    username: payload.username as string,
    role: payload.role as string,
  };
}

export function validatePasswordPolicy(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  return { valid: true };
}