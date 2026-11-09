import { randomUUID } from 'node:crypto';

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);

export const isId = (value: string) => /^[A-Za-z0-9-]{1,64}$/.test(value);
