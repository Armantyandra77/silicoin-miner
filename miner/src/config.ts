import 'dotenv/config';
import type { EnvConfig, BackendType } from './types.js';
import {
  SLC_ADDRESS,
  DEFAULT_RPC,
  DEFAULT_MAX_GAS_GWEI,
  DEFAULT_BUDGET_ETH,
  DEFAULT_WORKERS,
} from './constants.js';

function getEnv(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback;
}

function getRequired(key: string): `0x${string}` {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env: ${key}`);
  if (!val.startsWith('0x')) throw new Error(`${key} must start with 0x`);
  return val as `0x${string}`;
}

function parseEthToWei(ethStr: string): bigint {
  // Convert ETH string like "0.02" to wei bigint
  const [whole, fraction] = ethStr.split('.');
  const paddedFraction = (fraction || '0').padEnd(18, '0').slice(0, 18);
  const weiStr = whole + paddedFraction;
  return BigInt(weiStr);
}

export function loadConfig(): EnvConfig {
  const budgetStr = getEnv('BUDGET_ETH', DEFAULT_BUDGET_ETH);
  return {
    privateKey: getRequired('PRIVATE_KEY'),
    rpcUrl: getEnv('RPC_URL', DEFAULT_RPC),
    maxGasGwei: parseInt(getEnv('MAX_GAS_GWEI', String(DEFAULT_MAX_GAS_GWEI)), 10),
    budgetEth: parseEthToWei(budgetStr),
    minerBackend: (getEnv('MINER_BACKEND', 'auto') as BackendType),
    minerName: getEnv('MINER_NAME', 'unnamed-miner'),
    reportEnabled: getEnv('REPORT', 'on') === 'on',
    bundleMode: (getEnv('BUNDLE', 'flashbots') as 'flashbots' | 'mempool'),
    workers: parseInt(getEnv('WORKERS', String(DEFAULT_WORKERS)), 10),
    flashbotsRpc: getEnv('FLASHBOTS_RPC') || undefined,
  };
}

export function checkConfig(config: EnvConfig): void {
  if (config.privateKey.length !== 66) {
    throw new Error(`Invalid PRIVATE_KEY length: ${config.privateKey.length} (expected 66)`);
  }
  if (config.maxGasGwei <= 0) {
    throw new Error(`MAX_GAS_GWEI must be > 0, got ${config.maxGasGwei}`);
  }
  if (config.budgetEth <= 0n) {
    throw new Error(`BUDGET_ETH must be > 0, got ${config.budgetEth}`);
  }
  if (config.workers < 0) {
    throw new Error(`WORKERS must be >= 0, got ${config.workers}`);
  }
}

// Human-readable config summary (don't log the key!)
export function configSummary(config: EnvConfig): string {
  return `
Mining Config:
  Address:    ${config.privateKey.slice(0, 10)}...${config.privateKey.slice(-6)}
  RPC:        ${config.rpcUrl}
  Max Gas:    ${config.maxGasGwei} gwei
  Budget:     ${config.budgetEth} ETH
  Backend:    ${config.minerBackend}
  Workers:    ${config.workers || 'auto'}
  Bundle:     ${config.bundleMode}
  Reporting:  ${config.reportEnabled ? 'ON' : 'OFF'}
`.trim();
}