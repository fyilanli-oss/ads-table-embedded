export function buildGoogleShoppingSourceLinks(input: {
  scope: {workspace_id: string; install_generation: number; connection_id: string; reporting_account_id: string};
  dateWindow: {start: string; end: string};
  pdRows: readonly unknown[];
  productRows: readonly unknown[];
  saleRows: readonly unknown[];
}): Readonly<Record<string, any>>;
