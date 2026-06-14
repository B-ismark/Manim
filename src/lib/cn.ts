/** Tiny classnames joiner — keeps deps lean (no clsx). */
export type ClassValue = string | number | false | null | undefined | ClassValue[]

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  for (const i of inputs) {
    if (!i) continue
    if (Array.isArray(i)) {
      const r = cn(...i)
      if (r) out.push(r)
    } else {
      out.push(String(i))
    }
  }
  return out.join(' ')
}
