import 'express';
import { User } from '@/lib/types';

declare module 'express' {
  interface Request {
    user?: User;
  }
}