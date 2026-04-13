import { DataProvider } from './types';

export class InMemoryDataProvider<TValue> implements DataProvider<TValue> {
  private readonly records = new Map<string, TValue>();

  public async get(key: string): Promise<TValue | null> {
    return this.records.get(key) ?? null;
  }

  public async set(key: string, value: TValue): Promise<void> {
    this.records.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  public async keys(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }
}
