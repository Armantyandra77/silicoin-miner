import { createHash } from 'crypto';
import { loadConfig } from './config.js';

function keccak256(data: Buffer): Buffer {
  return createHash('keccak256').update(data).digest();
}

function bigintTo32Buffer(n: bigint): Buffer {
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function padAddress(addr: string): Buffer {
  const hex = addr.replace('0x', '').padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

async function benchJs() {
  const start = Date.now();
  let hashes = 0;
  const challenge = Buffer.alloc(32);
  const minerAddr = padAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f1e5b2');
  const target = BigInt('0x0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const nonce = BigInt(0);

  while (Date.now() - start < 2000) {
    const hashInput = Buffer.concat([challenge, minerAddr, bigintTo32Buffer(nonce)]);
    keccak256(hashInput);
    hashes++;
  }

  const elapsed = (Date.now() - start) / 1000;
  return { hps: hashes / elapsed, name: 'JavaScript (Node.js crypto)' };
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