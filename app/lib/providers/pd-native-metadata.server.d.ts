/** Internal server inputs only; these shape checks never establish request authority. */
export function preparePdNativeMetadata(input: {
  sourceContext: Readonly<Record<string, any>>;
  evidence: Readonly<Record<string, any>>;
}): Readonly<Record<string, any>>;
export function bindNativePdRecordMetadata(input: {
  prepared: Readonly<Record<string, any>>;
  sourceContext: Readonly<Record<string, any>>;
  evidence?: Readonly<Record<string, any>>;
  composition?: Readonly<Record<string, any>>;
  supplied?: Readonly<Record<string, any>>;
}): Readonly<Record<string, any>> | null;
