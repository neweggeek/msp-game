export function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`bad ip ${ip}`);
  }
  return (
    (((parts[0] as number) << 24) |
      ((parts[1] as number) << 16) |
      ((parts[2] as number) << 8) |
      (parts[3] as number)) >>>
    0
  );
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function isIp(text: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) && text.split(".").every((p) => Number(p) <= 255);
}

export function prefixToMask(prefix: number): string {
  return intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
}

export function maskToPrefix(mask: string): number | null {
  if (!isIp(mask)) return null;
  const n = ipToInt(mask);
  const prefix = 32 - Math.log2((~n >>> 0) + 1);
  return Number.isInteger(prefix) ? prefix : null;
}

/** "10.1.10.1/24" -> { ip, prefix } */
export function parseCidr(cidr: string): { ip: string; prefix: number } {
  const [ip, p] = cidr.split("/");
  return { ip: ip as string, prefix: Number(p ?? 32) };
}

export function inSubnet(ip: string, cidr: string): boolean {
  const { ip: net, prefix } = parseCidr(cidr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(net) & mask);
}

/** Host address n inside a subnet. hostIn("10.1.10.0/24", 1) -> 10.1.10.1 */
export function hostIn(cidr: string, n: number): string {
  const { ip } = parseCidr(cidr);
  return intToIp(ipToInt(ip) + n);
}
