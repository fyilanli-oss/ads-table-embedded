// Decimal arithmetic over the already-sanitized lexical number tokens in an
// authenticated source envelope. Native amounts never pass through Number.
const fail = () => {throw Error("DATASET_SOURCE_VALUE_INVALID");};
export function sourceScalar(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof value.jsonNumber === "string") return value.jsonNumber;
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
  fail();
}
export function sourceText(value, {nullable = false, max = 512} = {}) {
  const v = sourceScalar(value);
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== "string" || !v.length || v.length > max || /[\x00-\x1f]/.test(v)) fail();
  return v;
}
function parts(value) {
  const v = sourceScalar(value);
  if (typeof v !== "string" || v.length > 1024) fail();
  const m = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,3}))?$/.exec(v);
  if (!m) fail();
  // Only a bounded exponent/scale is converted, never the native value.
  const exponent = m[4] ? Number(m[4]) : 0;
  let n = BigInt(m[2] + (m[3] ?? "")), scale = (m[3]?.length ?? 0) - exponent;
  if (Math.abs(scale) > 512 || m[1] && n !== 0n) fail();
  if (scale < 0) {n *= 10n ** BigInt(-scale); scale = 0;}
  return {n, scale};
}
function render(n, scale) {
  if (n === 0n) return "0";
  while (scale > 0 && n % 10n === 0n) {n /= 10n; scale--;}
  let s = n.toString();
  if (scale) {s = s.padStart(scale + 1, "0"); s = s.slice(0, -scale) + "." + s.slice(-scale);}
  if (s.length > 128) fail();
  return s;
}
export function sourceDecimal(value, {micros = false} = {}) {
  if (value === null || value === undefined) return null;
  const {n, scale} = parts(value);
  return render(n, scale + (micros ? 6 : 0));
}
export function addSourceDecimals(a, b) {
  if (a === null) return b; if (b === null) return a;
  const x = parts(a), y = parts(b), scale = Math.max(x.scale, y.scale);
  return render(x.n * 10n ** BigInt(scale - x.scale) + y.n * 10n ** BigInt(scale - y.scale), scale);
}
export function positiveSourceDecimal(value) {const n = sourceDecimal(value); return n !== null && n !== "0";}
