export interface DataProvider<TValue> {
  get(key: string): Promise<TValue | null>;
  set(key: string, value: TValue): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
