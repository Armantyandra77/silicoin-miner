import { spawn } from 'child_process';
import { loadConfig } from './config.js';
import type { SearchResult } from './types.js';

interface GpuResult {
  status: 'found' | 'running' | 'error' | 'stopped' | 'started';
  nonce?: string;
  secret?: string;
  hashes?: number;
  hps?: number;
  gpu?: string;
  message?: string;
}

export class GpuMiner {
  private proc: ReturnType<typeof spawn> | null = null;
  private resolvecb: ((r: SearchResult) => void) | null = null;
  private rejectcb: ((e: Error) => void) | null = null;
  private startTime = 0;
  private totalHashes = 0;

  async search(
    challenge: `0x${string}`,
    minerAddr: `0x${string}`,
    target: bigint,
    onProgress?: (hashes: bigint) => void
  ): Promise<SearchResult> {
    const targetHex = '0x' + target.toString(16).padStart(64, '0');
    const scriptPath = './gpu/gpu_miner.py';

    return new Promise((resolve, reject) => {
      this.resolvecb = resolve;
      this.rejectcb = reject;
      this.startTime = Date.now();
      this.totalHashes = 0;

      console.log(`    [GPU] Starting GPU miner...`);
      console.log(`    [GPU] Challenge: ${challenge.slice(0, 20)}...`);
      console.log(`    [GPU] Target: ${targetHex.slice(0, 20)}...`);

      this.proc = spawn('python3', [
        scriptPath,
        challenge,
        minerAddr,
        targetHex
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      let stderr = '';

      this.proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg: GpuResult = JSON.parse(line);
            this.handleGpuMessage(msg, onProgress);
          } catch {
            // Not JSON, just log
            if (line.includes('GPU:') || line.includes('CUDA:')) {
              console.log(`    [GPU] ${line.trim()}`);
            }
          }
        }
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.proc.on('close', (code) => {
        this.proc = null;
        if (code !== 0 && code !== null) {
          const errMsg = stderr.slice(0, 300) || `GPU miner exited code ${code}`;
          console.log(`    [GPU] Miner stopped: ${errMsg}`);
          reject(new Error(errMsg));
        }
      });

      this.proc.on('error', (err) => {
        this.proc = null;
        reject(new Error(`GPU miner error: ${err.message}`));
      });

      // Timeout 10 minutes
      setTimeout(() => {
        if (this.proc) {
          this.kill();
          reject(new Error('GPU search timeout (10 min)'));
        }
      }, 600000);
    });
  }

  private handleGpuMessage(msg: GpuResult, onProgress?: (hashes: bigint) => void) {
    switch (msg.status) {
      case 'started':
        console.log(`    [GPU] Mining on ${msg.gpu || 'GPU'}`);
        break;

      case 'running':
        this.totalHashes = msg.hashes || this.totalHashes;
        if (onProgress && msg.hashes) {
          onProgress(BigInt(msg.hashes));
        }
        if (msg.hps) {
          process.stdout.write(`\r    [GPU] Hashes: ${(msg.hashes || 0).toLocaleString()} | ${msg.hps.toLocaleString()}/s     `);
          process.stdout.flush();
        }
        break;

      case 'found':
        console.log(`\n    [GPU] ✓ FOUND! Nonce: ${msg.nonce}, Time: ${msg.time_ms}ms, Hashes: ${msg.hashes?.toLocaleString()}`);
        if (this.resolvecb && msg.nonce && msg.secret) {
          this.resolvecb({
            nonce: BigInt(msg.nonce),
            secret: msg.secret as `0x${string}`,
            challenge: '0x' as `0x${string}`, // Not used after found
          });
        }
        this.cleanup();
        break;

      case 'error':
        console.log(`\n    [GPU] Error: ${msg.message}`);
        if (this.rejectcb) {
          this.rejectcb(new Error(msg.message || 'GPU error'));
        }
        this.cleanup();
        break;

      case 'stopped':
        this.cleanup();
        break;
    }
  }

  private cleanup() {
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
    this.resolvecb = null;
    this.rejectcb = null;
  }

  kill() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// Check if GPU is available
export async function checkGpuAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', `
import sys
try:
    import torch
    if torch.cuda.is_available():
        print("GPU:" + torch.cuda.get_device_name(0))
        sys.exit(0)
    else:
        print("NO_GPU")
        sys.exit(1)
except ImportError:
    print("NO_TORCH")
    sys.exit(1)
`], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout?.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 && output.includes('GPU:'));
    });
    proc.on('error', () => resolve(false));

    setTimeout(() => { proc.kill(); resolve(false); }, 5000);
  });
}