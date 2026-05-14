import { cudaSearchOnce, findCudaBinary, cudaAvailable } from './cuda.js';
import { ethers } from 'ethers';

const BENCH_CHALLENGE = '0x' + '00'.repeat(32);
const BENCH_MINER = '0x' + '00'.repeat(20);
const BENCH_TARGET = BigInt('0x' + 'ff'.repeat(32));

async function main() {
  console.log('=== CUDA Benchmark ===\n');

  if (!cudaAvailable()) {
    console.log('CUDA binary not found. Run: npm run build:cuda');
    return;
  }

  const cudaBinary = findCudaBinary();
  console.log(`Binary: ${cudaBinary}\n`);

  const batches = [1024, 4096, 16384, 65536, 262144, 1048576];

  for (const batch of batches) {
    process.stdout.write(`Batch ${(batch/1024).toFixed(0).padStart(7)}K: `);
    
    const start = Date.now();
    try {
      const result = await cudaSearchOnce({
        ch: BENCH_CHALLENGE,
        target: BENCH_TARGET,
        miner: BENCH_MINER,
      });
      
      const ms = Date.now() - start;
      const hps = result.hps || 0;
      console.log(`${hps.toLocaleString().padStart(10)} H/s  (${ms}ms)`);
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);