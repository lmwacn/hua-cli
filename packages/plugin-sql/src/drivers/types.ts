export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  affectedRows?: number;
  command?: string;
}

export interface SqlConnection {
  query(statement: string): Promise<SqlResult[]>;
  close(): Promise<void>;
  onError(listener: (error: Error) => void): () => void;
}
