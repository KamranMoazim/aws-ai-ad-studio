const KEY_ATTRIBUTES = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'expiresAt'];

export function withoutKeys<T>(item: Record<string, unknown>): T {
  const entity = { ...item };
  for (const attribute of KEY_ATTRIBUTES) {
    delete entity[attribute];
  }
  return entity as T;
}
