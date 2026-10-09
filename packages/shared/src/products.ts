export const PRODUCTS = ['certa', 'argus'] as const;

export type Product = (typeof PRODUCTS)[number];

const LABELS: Record<Product, string> = {
  certa: 'Certa',
  argus: 'Argus',
};

export function isProduct(value: unknown): value is Product {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}

export function productLabel(product: Product): string {
  return LABELS[product];
}

/** Case-insensitive lookup from a display name or slug ("Certa", "certa") to a product. */
export function parseProduct(value: string): Product | undefined {
  const normalized = value.trim().toLowerCase();
  return isProduct(normalized) ? normalized : undefined;
}
