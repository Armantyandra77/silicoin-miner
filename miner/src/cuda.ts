import { config } from './config.js';
import { proofHash, hashBeatsTarget } from './slc.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function strip0x(x: string) { return x.startsWith('0x') ? x.slice(2) : x; }
function asUint64Decimal(x: bigint) { return (x & ((1n << 64n) - 1n)).toString(); }

export function findCudaBinary() {
  const candidates = [
    process.env.CUDA_MINER_BIN,
    path.join(rootDir, 'bin', 'slc-cuda'),
    path.join(process.cwd(), 'bin', 'slc-cuda'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c!)) return c!;
  }
  return null;
}

export function cudaAvailable() {
  return Boolean(findCudaBinary());
}

function cudaEnv() {
  const env = { ...process.env };
  if (config.cudaThreads > 0) env.CUDA_THREADS = String(config.cudaThreads);
  if (config.cudaBlocks > 0) env.CUDA_BLOCKS = String(config.cudaBlocks);
  if (config.cudaBlocksMult > 0) env.CUDA_BLOCKS_MULT = String(config.cudaBlocksMult);
  return env;
}

function parseCudaMessage(line: string) {
  try { return JSON.parse(line); }
  catch { throw new Error(`CUDA JSON parse failed: ${line}`); }
}

function verifyCudaResult({ msg, ch, target, miner, started }: {
  msg: any; ch: string; target: bigint; miner: string; started: number;
}) {
  const tried = Number(msg.tried || config.cudaBatch);
  const dt = Math.max(0.001, (Date.now() - started) / 1000);
  const base = {
    backend: 'cuda', tried, hps: Number(msg.hps || tried / dt),
    device: msg.device || 'CUDA GPU', blocks: msg.blocks, threads: msg.threads
  };
  if (msg.type === 'error') throw new Error(`CUDA worker error: ${msg.error || 'unknown'}`);
  if (msg.type !== 'found') return { found: false, ...base };

  const cpuHash = proofHash(ch as `0x${string}`, miner as `0x${string}`, BigInt(msg.nonce));
  if (cpuHash.toLowerCase() !== String(msg.hash).toLowerCase()) {
    throw new Error(`CUDA self-check mismatch nonce=${msg.nonce} gpu=${msg.hash} cpu=${cpuHash}`);
  }
  if (!hashBeatsTarget(cpuHash, target)) {
    throw new Error(`CUDA nonce failed target check nonce=${msg.nonce} hash=${cpuHash}`);
  }
  return { found: true, nonce: msg.nonce, hash: cpuHash, ...base };
}

async function cudaSearchOneShot({ ch, target, miner, startNonce }: {
  ch: string; target: bigint; miner: string; startNonce?: bigint;
}) {
  const bin = findCudaBinary();
  if (!bin) throw new Error('CUDA binary not found. Run: npm run build:cuda');

  const start = asUint64Decimal(startNonce ?? BigInt('0x' + Buffer.from(ethers.randomBytes(8)).toString('hex')));
  const batch = String(config.cudaBatch);
  const args = [strip0x(ch), strip0x(miner), strip0x(ethers.toBeHex(target, 32)), start, batch];
  const started = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`CUDA miner exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) {
        reject(new Error('CUDA miner produced no JSON output'));
        return;
      }
      try {
        const msg = parseCudaMessage(line);
        resolve(verifyCudaResult({ msg, ch, target, miner, started }));
      } catch (err) { reject(err); }
    });
  });
}

export async function cudaSearchOnce({ ch, target, miner, startNonce }: {
  ch: string; target: bigint; miner: string; startNonce?: bigint;
}) {
  return await cudaSearchOneShot({ ch, target, miner, startNonce });
}