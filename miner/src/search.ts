import { keccak256 } from 'viem';
import type { SearchResult } from './types.js';

// Generate random bytes using Node.js crypto
function randomBytes(len: number): Uint8Array {
  return new Uint8Array(crypto.getRandomValues(new Uint8Array(len)));
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace('0x', '');
  return new Uint8Array(Buffer.from(cleanHex, 'hex'));
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of parts) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

function padAddressTo32(addr: string): Uint8Array {
  const hex = addr.replace('0x', '').padStart(64, '0');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function bigintTo32Bytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export interface SearchInputs {
  epochSeed: `0x${string}`;
  anchorHash: `0x${string}`;
  minerAddr: `0x${string}`;
  target: bigint;
}

export function findNonce(inputs: SearchInputs): SearchResult | null {
  const { epochSeed, anchorHash, minerAddr, target } = inputs;

  // challenge = keccak256(anchorHash ‖ epochSeed)
  const anchorBytes = hexToBytes(anchorHash);
  const seedBytes = hexToBytes(epochSeed);
  const challengeHex = keccak256(concatBytes(anchorBytes, seedBytes));
  const challengeBytes = hexToBytes(challengeHex);

  const minerAddrBuf = padAddressTo32(minerAddr);
  let nonce = BigInt('0x' + bytesToHex(randomBytes(32)).slice(2));
  let hashes = 0n;

  // Search loop
  while (true) {
    const nonceBytes = bigintTo32Bytes(nonce);
    const hashInput = concatBytes(challengeBytes, minerAddrBuf, nonceBytes);
    const hashHex = keccak256(hashInput);
    const hashBytes = hexToBytes(hashHex);

    hashes++;

    // Convert to bigint for comparison
    const hashBigint = BigInt(hashHex);

    if (hashBigint < target) {
      // Found valid nonce!
      const secretBytes = randomBytes(32);
      const secret = bytesToHex(secretBytes) as `0x${string}`;
      return { nonce, secret, challenge: challengeHex };
    }

    nonce++;
  }
}

export function computeCommitment(
  nonce: bigint,
  secret: `0x${string}`,
  minerAddr: `0x${string}`,
  anchorBlock: bigint
): `0x${string}` {
  // commitment = keccak256(abi.encodePacked(nonce, secret, minerAddr, anchorBlock))
  const commitmentHash = keccak256(
    concatBytes(
      bigintTo32Bytes(nonce),
      hexToBytes(secret),
      padAddressTo32(minerAddr),
      bigintTo32Bytes(anchorBlock)
    )
  );
  return commitmentHash;
}

export function estimateWinProbability(hashesPerRound: bigint, target: bigint): number {
  const total = hashesPerRound * target;
  const divisor = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  return Number(total / divisor) * 100;
}