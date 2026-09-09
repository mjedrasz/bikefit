// Minimal stub so the reviewer agent has a neighbouring module to explore.
export interface Row {
  id: number;
  name: string;
  password: string;
}

export const db = {
  async query(_sql: string): Promise<Row[]> {
    return [];
  },
};
