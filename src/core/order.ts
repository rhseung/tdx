// Python-style sorting by key tuple, which is how every order in this tool is
// stated: a list of tie-breakers read left to right.

export type Key = readonly (string | number)[];

export function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

export function sortBy<T>(items: Iterable<T>, key: (item: T) => Key): T[] {
  return [...items].sort((a, b) => compareKeys(key(a), key(b)));
}
