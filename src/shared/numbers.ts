export const sortedUnique = (values: number[]): number[] => [...new Set(values)].toSorted((a, b) => a - b);
