import { keccak256 } from 'viem';
import { loadConfig } from './config.js';

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.replace('0x', ''), 'hex'));
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

async function benchJs() {
  const challenge = new Uint8Array(32);
  const minerAddr = padAddressTo32('0x742d35Cc6634C0532925a3b844Bc9e7595f1e5b2');
  const target = BigInt('0x0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const nonceBytes = new Uint8Array(32);

  const start = Date.now();
  let hashes = 0;

  while (Date.now() - start < 2000) {
    const hashInput = concatBytes(challenge, minerAddr, nonceBytes);
    keccak256(hashInput);
    hashes++;

    // Increment nonce bytes
    for (let i = 31; i >= 0; i--) {
      nonceBytes[i] = (nonceBytes[i] + 1) & 0xff;
      if (nonceBytes[i] !== 0) break;
    }
  }

  const elapsed = (Date.now() - start) / 1000;
  return { hps: hashes / elapsed, name: 'JavaScript (viem keccak256)' };
}

console.log('\n=== Silicoin Miner Benchmark ===\n');
console.log('Running 2-second benchmark...\n');

const result = await benchJs();
console.log(`Backend: ${result.name}`);
console.log(`Speed:   ${result.hps.toLocaleString()} hashes/sec`);
console.log('');

const config = loadConfig();
console.log('Config:');
console.log(`  RPC:     ${config.rpcUrl}`);
console.log(`  Backend: ${config.minerBackend}`);
console.log(`  Workers: ${config.workers || 'auto'}`);
console.log('');

console.log('Note: GPU backend requires OpenCL/CUDA setup.');
console.log('      Native backend requires Rust compiled addon.');
console.log('');
console.log('For GPU:  install NVIDIA CUDA Toolkit + OpenCL SDK');
console.log('For native: run npm run build:native (requires Rust)');
console.log('');