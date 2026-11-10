// Tiny class-name joiner — the project deliberately ships no `clsx`/`tailwind-merge` dependency.
// Falsy entries are dropped so conditional classes stay readable at call sites.

export function cn(...values: Array<string | false | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
