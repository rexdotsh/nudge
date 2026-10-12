export type SqlValue = string | number | null;

export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

export function count(sql: Sql, query: string, ...bindings: SqlValue[]): number {
  return sql.exec<{ count: number }>(query, ...bindings).toArray()[0]?.count ?? 0;
}
