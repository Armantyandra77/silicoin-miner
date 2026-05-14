import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { loadConfig, checkConfig, configSummary } from './config.js';
import { createWallet, getAddress } from './wallet.js';
import {
  createClients,
  getMineParams,
  getLatestBlock,
  getBlockHash,
  getGasPrice,
  getBalance,
  getSlcBalance,
} from './chain.js';
import { findNonce, computeCommitment, estimateWinProbability } from './search.js';
import { submitCommitRevealMempool } from './tx.js';
import { sendReport } from './report.js';
import { ANCHOR_SAFE_DISTANCE, RPC_FALLBACKS } from './constants.js';
import type { MiningStats } from './types.js';
import { formatEther } from 'viem';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ALL_RPCS = (rpc: string) => [rpc, ...RPC_FALLBACKS.filter(u => u !== rpc)];

let currentRpcIndex = 0;

function getNextRpc(primaryRpc: string): string {
  const rpcs = ALL_RPCS(primaryRpc);
  const rpc = rpcs[currentRpcIndex % rpcs.length];
  currentRpcIndex++;
  return rpc;
}

async function getSlcPriceUsd(): Promise<number> {
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xbb572707D09eB2E80C835D3051097E5083D460Cc');
    if (!res.ok) return 0;
    const data = await res.json();
    if (data.pairs && data.pairs.length > 0) {
      return parseFloat(data.pairs[0].priceUsd || '0');
    }
  } catch {}
  return 0;
}

async function miningLoop() {
  console.log('\n=== Silicoin Miner Starting ===\n');

  // Load and validate config
  const config = loadConfig();
  checkConfig(config);
  console.log(configSummary(config));
  console.log('');

  // Setup clients with primary RPC
  let { publicClient } = createClients(config.rpcUrl);
  const { account, walletClient } = createWallet(config);
  const minerAddr = getAddress(account);

  console.log(`Miner address: ${minerAddr}\n`);

  // Initial state
  let stats: MiningStats = {
    wins: 0,
    slcMined: 0n,
    gasSpent: 0n,
    hashesChecked: 0n,
    hashrate: 0,
    walletEth: 0n,
    walletSlc: 0n,
  };

  let totalGasSpent = 0n;
  let lastReportTime = 0;
  let lastHashrate = 0;
  let lastWinTx: `0x${string}` | undefined;
  let lastWinBlock: number | undefined;
  let lastWinAt: number | undefined;
  let rpcFailureCount = 0;

  // Helper to rotate RPC on failure
  async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
    const rpcs = ALL_RPCS(config.rpcUrl);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < rpcs.length; attempt++) {
      try {
        // Recreate client with current RPC
        publicClient = createClients(rpcs[attempt % rpcs.length]).publicClient;
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (attempt < rpcs.length - 1) {
          console.log(`  RPC failed, trying next... (${err.message?.slice(0, 60)})`);
        }
      }
    }
    throw lastError;
  }

  console.log('Checking if pool is live...\n');

  let poolLive = false;
  try {
    const initialParams = await withRpcRetry(() => getMineParams(publicClient));
    poolLive = initialParams.poolLive;
    if (!poolLive) {
      console.log('ERROR: Pool is not live yet. Wait for deployer to open trading.');
      return;
    }
    console.log(`Pool is LIVE. Reward: ${initialParams.reward.toLocaleString()} SLC\n`);
  } catch (err) {
    console.log(`ERROR: Cannot connect to RPC. All endpoints failed.`);
    console.log(`Try: RPC_URL=https://rpc.ankr.com/eth in .env`);
    return;
  }

  // Main mining loop
  while (true) {
    try {
      // Check gas price
      const gasPrice = await withRpcRetry(() => getGasPrice(publicClient));
      const gasPriceGwei = Number(gasPrice) / 1e9;

      // Check budget
      if (totalGasSpent >= config.budgetEth) {
        console.log('\n=== BUDGET EXHAUSTED ===');
        console.log(`Gas spent: ${formatEther(totalGasSpent)} ETH`);
        console.log(`Wins: ${stats.wins}`);
        console.log(`SLC mined: ${stats.slcMined.toLocaleString()}`);
        break;
      }

      // Pause if gas too high
      if (gasPriceGwei > config.maxGasGwei) {
        console.log(`[${new Date().toISOString()}] Gas too high (${gasPriceGwei.toFixed(1)} gwei > ${config.maxGasGwei}). Waiting...`);
        await sleep(30000);
        continue;
      }

      // Get latest mine params
      const params = await withRpcRetry(() => getMineParams(publicClient));
      const currentEpoch = params.epoch;

      // Get anchor block (latest - 2 for safety)
      const latestBlock = await withRpcRetry(() => getLatestBlock(publicClient));
      const anchorBlock = latestBlock - ANCHOR_SAFE_DISTANCE;
      const anchorHash = await withRpcRetry(() => getBlockHash(publicClient, anchorBlock));

      // Re-read params after getting anchor (race condition protection)
      const paramsAfterAnchor = await withRpcRetry(() => getMineParams(publicClient));
      if (paramsAfterAnchor.epoch !== currentEpoch || paramsAfterAnchor.target !== params.target) {
        console.log('Params changed during anchor selection - retrying...');
        continue;
      }

      // Search for valid nonce
      console.log(`[Epoch ${currentEpoch}] Searching from anchor block ${anchorBlock}...`);
      const searchStart = Date.now();

      const result = findNonce({
        epochSeed: params.epochSeed,
        anchorHash: anchorHash,
        minerAddr: minerAddr,
        target: params.target,
      });

      const searchTime = (Date.now() - searchStart) / 1000;
      lastHashrate = Math.round(Number(stats.hashesChecked) / searchTime);

      console.log(`  Found nonce in ${searchTime.toFixed(2)}s`);
      console.log(`  Nonce: ${result.nonce.toString()}`);

      // Compute commitment
      const commitment = computeCommitment(result.nonce, result.secret, minerAddr, BigInt(anchorBlock));
      console.log(`  Commitment: ${commitment}`);

      // Submit commit+reveal
      const targetBlock = latestBlock + 1;
      console.log(`  Commit → block ${targetBlock}, Reveal → block ${targetBlock + 1}`);

      const submitResult = await submitCommitRevealMempool(
        walletClient,
        account,
        commitment,
        result.nonce,
        result.secret,
        anchorBlock,
        publicClient
      );

      if (submitResult.success && submitResult.commitTx) {
        stats.wins++;
        lastWinTx = submitResult.commitTx;
        lastWinBlock = targetBlock + 1;
        lastWinAt = Date.now();

        console.log(`  ✓ Win #${stats.wins}! Commit: ${submitResult.commitTx}`);
        console.log(`  TX: https://etherscan.io/tx/${submitResult.commitTx}`);
      } else {
        console.log(`  ✗ Submit failed: ${submitResult.error || 'unknown'}`);
      }

      // Update balances
      const [ethBal, slcBal] = await Promise.all([
        withRpcRetry(() => getBalance(publicClient, minerAddr)),
        withRpcRetry(() => getSlcBalance(publicClient, minerAddr)),
      ]);
      stats.walletEth = ethBal;
      stats.walletSlc = slcBal;

      // Report telemetry
      if (config.reportEnabled && Date.now() - lastReportTime > 60000) {
        await sendReport(
          account,
          stats,
          currentEpoch,
          config.budgetEth,
          lastHashrate,
          config.workers,
          lastWinTx,
          lastWinBlock,
          lastWinAt
        );
        lastReportTime = Date.now();
      }

      // Small delay between rounds
      await sleep(1000);

    } catch (err: any) {
      console.error(`\nError: ${err.message?.slice(0, 100)}`);
      await sleep(5000);
    }
  }

  // Final summary
  console.log('\n=== Mining Complete ===');
  console.log(`Wins: ${stats.wins}`);
  console.log(`SLC: ${stats.slcMined.toLocaleString()}`);
  console.log(`Gas spent: ${formatEther(totalGasSpent)} ETH`);
}

// Entry point
miningLoop().catch(console.error);