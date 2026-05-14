import { createHash } from 'crypto';
import type { SearchResult } from './types.js';

// keccak256 hash function
export function keccak256(data: Buffer): Buffer {
  return createHash('keccak256').update(data).digest();
}

// Concatenate two buffers
function concatBuffers(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

// Pad address to 32 bytes
function padAddress(addr: `0x${string}`): Buffer {
  const hex = addr.replace('0x', '');
  const padded = hex.padStart(64, '0');
  return Buffer.from(padded, 'hex');
}

// Convert bigint to 32-byte buffer (big-endian)
function bigintTo32Buffer(n: bigint): Buffer {
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

// Generate random secret (32 bytes)
function randomSecret(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

// Generate random starting nonce
function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

export interface SearchInputs {
  epochSeed: `0x${string}`;
  anchorHash: `0x${string}`;
  minerAddr: `0x${string}`;
  target: bigint;
}

export function findNonce(inputs: SearchInputs, onProgress?: (hashes: bigint) => void): SearchResult | null {
  const { epochSeed, anchorHash, minerAddr, target } = inputs;

  // challenge = keccak256(anchorHash ‖ epochSeed)
  const challengeHash = keccak256(
    concatBuffers(
      Buffer.from(anchorHash.replace('0x', ''), 'hex'),
      Buffer.from(epochSeed.replace('0x', ''), 'hex')
    )
  );

  const minerAddrBuf = padAddress(minerAddr);
  let nonce = randomNonce();
  let hashes = 0n;

  // Search loop - iterate nonce until keccak256(challenge ‖ minerAddr ‖ nonce) < target
  while (true) {
    const nonceBuf = bigintTo32Buffer(nonce);
    const hashInput = concatBuffers(challengeHash, minerAddrBuf, nonceBuf);
    const hashResult = keccak256(hashInput);

    hashes++;

    if (onProgress && hashes % 1000000n === 0n) {
      onProgress(hashes);
    }

    const hashBigint = BigInt('0x' + hashResult.toString('hex'));

    if (hashBigint < target) {
      // Found valid nonce!
      const secret = ('0x' + randomSecret().toString('hex')) as `0x${string}`;
      return { nonce, secret, challenge: '0x' + challengeHash.toString('hex') };
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
    concatBuffers(
      bigintTo32Buffer(nonce),
      Buffer.from(secret.replace('0x', ''), 'hex'),
      padAddress(minerAddr),
      bigintTo32Buffer(anchorBlock)
    )
  );
  return ('0x' + commitmentHash.toString('hex')) as `0x${string}`;
}

// Estimate probability per round
export function estimateWinProbability(hashesPerRound: bigint, target: bigint): number {
  // target is compared against uint256 keccak output
  // Probability = hashesPerRound * target / 2^256
  // We do hashesPerRound iterations of keccak < target check
  const total = hashesPerRound * target;
  const divisor = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  return Number(total / divisor) * 100;
}