/**
 * The solver KAT's number codec (architecture §3.5 layer 3).
 *
 * Every double in `data/kat/solver-kat.json` is the 16 lowercase hex digits of its IEEE-754 bits,
 * big-endian, prefixed "0x" — so no decimal formatter and no JSON number parser sits between the
 * reference and a port. Shared by the generator under tools/ and by test/solve.spec.ts.
 */

const buf = new ArrayBuffer(8);
const dv = new DataView(buf);

export function hexOfDouble(x: number): string {
  dv.setFloat64(0, x, false);
  let s = '';
  for (let i = 0; i < 8; i++) s += dv.getUint8(i).toString(16).padStart(2, '0');
  return '0x' + s;
}

export function doubleOfHex(h: string): number {
  if (!/^0x[0-9a-f]{16}$/.test(h)) throw new Error('kat: bad hex double ' + h);
  for (let i = 0; i < 8; i++) dv.setUint8(i, Number.parseInt(h.slice(2 + i * 2, 4 + i * 2), 16));
  return dv.getFloat64(0, false);
}

export function hexArray(xs: ArrayLike<number>): string[] {
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) out.push(hexOfDouble(xs[i] as number));
  return out;
}

export function doubleArray(hs: readonly string[]): Float64Array {
  const out = new Float64Array(hs.length);
  for (let i = 0; i < hs.length; i++) out[i] = doubleOfHex(hs[i] as string);
  return out;
}
