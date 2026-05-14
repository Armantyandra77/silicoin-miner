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
import { findNonce, computeCommitment } from './search.js';
import { submitCommitRevealMempool } from './tx.js';
import { sendReport } from './report.js';
import { GpuMiner, checkGpuAvailable } from './backends/gpu-wrapper.js';
import { ANCHOR_SAFE_DISTANCE, RPC_FALLBACKS } from './constants.js';
import type { MiningStats } from './types.js';
import { formatEther } from 'viem';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ALL_RPCS = (rpc: string) => [rpc, ...RPC_FALLBACKS.filter(u => u !== rpc)];

let currentRpcIndex = 0;

function getNextRpc(primaryRpc: string): string {
  const rpcs = ALL_RPCS(primaryRpc);
  return rpcs[currentRpcIndex++ % rpcs.length];
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

async function withRpcRetry<T>(
  config: { rpcUrl: string },
  publicClient: ReturnType<typeof createPublicClient>,
  fn: () => Promise<T>
): Promise<T> {
  const rpcs = ALL_RPCS(config.rpcUrl);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < rpcs.length; attempt++) {
    try {
      publicClient = createClients(rpcs[attempt % rpcs.length]).publicClient;
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < rpcs.length - 1) {
        console.log(`  RPC ${rpcs[attempt % rpcs.length].slice(0, 40)}... failed, trying fallback`);
      }
    }
  }
  throw lastError;
}

async function miningLoop() {
  console.log('\n=== Silicoin Miner Starting ===\n');

  const config = loadConfig();
  checkConfig(config);
  console.log(configSummary(config));
  console.log('');

  let { publicClient } = createClients(config.rpcUrl);
  const { account, walletClient } = createWallet(config);
  const minerAddr = getAddress(account);

  console.log(`Miner address: ${minerAddr}`);
  console.log(`Checking GPU availability...`);

  const gpuAvailable = await checkGpuAvailable();
  const useGpu = gpuAvailable && (config.minerBackend === 'gpu' || config.minerBackend === 'auto');

  const gpuMiner = useGpu ? new GpuMiner() : null;

  if (useGpu) {
    console.log(`✓ GPU miner available (PyTorch + CUDA)\n`);
  } else {
    console.log(`✗ GPU not available, using JavaScript fallback\n`);
    console.log(`  To use GPU: pip install torch --index-url https://download.pytorch.org/whl/cu121`);
    console.log(`             pip install pycryptodome\n`);
  }

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
  let searchStartTime = 0;
  let currentEpoch = 0;

  console.log('Checking if pool is live...\n');

  let poolLive = false;
  try {
    const initialParams = await withRpcRetry(config, publicClient, () => getMineParams(publicClient));
    poolLive = initialParams.poolLive;
    currentEpoch = initialParams.epoch;
    if (!poolLive) {
      console.log('ERROR: Pool is not live yet.');
      return;
    }
    console.log(`Pool is LIVE. Reward: ${initialParams.reward.toLocaleString()} SLC (${(Number(initialParams.reward) / 1e18).toFixed(0)} SLC)\n`);
  } catch (err) {
    console.log(`ERROR: Cannot connect to RPC. Check your RPC_URL in .env`);
    return;
  }

  // Main mining loop
  while (true) {
    try {
      const gasPrice = await withRpcRetry(config, publicClient, () => getGasPrice(publicClient));
      const gasPriceGwei = Number(gasPrice) / 1e9;

      if (totalGasSpent >= config.budgetEth) {
        console.log('\n=== BUDGET EXHAUSTED ===');
        console.log(`Gas spent: ${formatEther(totalGasSpent)} ETH`);
        console.log(`Wins: ${stats.wins}`);
        console.log(`SLC mined: ${stats.slcMined.toLocaleString()}`);
        break;
      }

      if (gasPriceGwei > config.maxGasGwei) {
        console.log(`[${new Date().toISOString()}] Gas too high (${gasPriceGwei.toFixed(1)} gwei > ${config.maxGasGwei}). Waiting...`);
        await sleep(30000);
        continue;
      }

      // Get mine params
      const params = await withRpcRetry(config, publicClient, () => getMineParams(publicClient));
      currentEpoch = params.epoch;

      // Get anchor block
      const latestBlock = await withRpcRetry(config, publicClient, () => getLatestBlock(publicClient));
      const anchorBlock = latestBlock - ANCHOR_SAFE_DISTANCE;
      const anchorHash = await withRpcRetry(config, publicClient, () => getBlockHash(publicClient, anchorBlock));

      // Verify params didn't change
      const paramsCheck = await withRpcRetry(config, publicClient, () => getMineParams(publicClient));
      if (paramsCheck.epoch !== currentEpoch || paramsCheck.target !== params.target) {
        console.log('Params changed during anchor - retrying...');
        continue;
      }

      searchStartTime = Date.now();
      console.log(`\n[Epoch ${currentEpoch}] Anchor block ${anchorBlock} | Target: ${params.target.toString(16).slice(0, 12)}...`);

      let result: { nonce: bigint; secret: `0x${string}` } | null = null;

      if (useGpu && gpuMiner) {
        // GPU search
        try {
          result = await gpuMiner.search(
            params.epochSeed,
            minerAddr,
            params.target
          );
        } catch (err: any) {
          console.log(`  GPU search failed: ${err.message.slice(0, 100)} - falling back to JS`);
          result = findNonce({
            epochSeed: params.epochSeed,
            anchorHash: anchorHash,
            minerAddr: minerAddr,
            target: params.target,
          });
        }
      } else {
        // JS fallback
        result = findNonce({
          epochSeed: params.epochSeed,
          anchorHash: anchorHash,
          minerAddr: minerAddr,
          target: params.target,
        });
      }

      const searchTime = (Date.now() - searchStartTime) / 1000;

      if (!result) {
        console.log('  No result - retrying');
        continue;
      }

      console.log(`  Found nonce in ${searchTime.toFixed(2)}s | Nonce: ${result.nonce.toString()}`);

      // Compute commitment
      const commitment = computeCommitment(result.nonce, result.secret, minerAddr, BigInt(anchorBlock));

      // Submit
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

        console.log(`\n  ✓ Win #${stats.wins}! Commit TX: ${submitResult.commitTx}`);
        console.log(`  https://etherscan.io/tx/${submitResult.commitTx}\n`);
      } else {
        console.log(`  ✗ Submit failed: ${submitResult.error || 'unknown'}\n`);
      }

      // Update balances
      const [ethBal, slcBal] = await Promise.all([
        withRpcRetry(config, publicClient, () => getBalance(publicClient, minerAddr)),
        withRpcRetry(config, publicClient, () => getSlcBalance(publicClient, minerAddr)),
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

      await sleep(1000);

    } catch (err: any) {
      console.error(`\nError: ${err.message?.slice(0, 150)}`);
      await sleep(5000);
    }
  }

  gpuMiner?.kill();

  console.log('\n=== Mining Complete ===');
  console.log(`Wins: ${stats.wins}`);
  console.log(`SLC: ${stats.slcMined.toLocaleString()}`);
  console.log(`Gas spent: ${formatEther(totalGasSpent)} ETH`);
}

miningLoop().catch(console.error);