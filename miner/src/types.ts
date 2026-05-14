export interface MineParams {
  epochSeed: `0x${string}`;
  target: bigint;
  reward: bigint;
  epoch: number;
  poolLive: boolean;
}

export interface CommitReveal {
  nonce: bigint;
  secret: `0x${string}`;
  anchorBlock: bigint;
  commitment: `0x${string}`;
}

export interface MiningStats {
  wins: number;
  slcMined: bigint;
  gasSpent: bigint;
  hashesChecked: bigint;
  hashrate: number; // hashes per second
  walletEth: bigint;
  walletSlc: bigint;
  lastWinTx?: `0x${string}`;
  lastWinBlock?: number;
}

export interface ReportPayload {
  v: number;
  addr: string;
  ts: number;
  chain: number;
  name?: string;
  client?: string;
  workers?: number;
  hps?: number;
  epoch?: number;
  wins?: number;
  minedSlc?: string;
  balanceSlc?: string;
  gasEth?: string;
  budgetEth?: string;
  walletEth?: string;
  lastWinTx?: string;
  lastWinBlock?: number;
  lastWinAt?: number;
}

export type BackendType = 'gpu' | 'native' | 'js' | 'auto';

export interface SearchResult {
  nonce: bigint;
  secret: `0x${string}`;
  challenge: `0x${string}`;
}

export interface EnvConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  maxGasGwei: number;
  budgetEth: bigint;
  minerBackend: BackendType;
  minerName: string;
  reportEnabled: boolean;
  bundleMode: 'flashbots' | 'mempool';
  workers: number;
  flashbotsRpc?: string;
  // CUDA GPU config
  cudaBatch: number;
  cudaThreads: number;
  cudaBlocks: number;
  cudaBlocksMult: number;
}