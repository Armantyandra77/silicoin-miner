import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { loadConfig } from './config.js';
import { getAddress } from './wallet.js';
import { getMineParams, getTotalMined, getBalance, getSlcBalance, getGasPrice, createClients } from './chain.js';
import { SLC_DECIMALS } from './constants.js';
import { formatEther } from 'viem';

export async function showStatus(): Promise<void> {
  const config = loadConfig();
  const { publicClient } = createClients(config.rpcUrl);
  const { account } = await import('./wallet.js').then(m => m.createWallet(config));
  const minerAddr = getAddress(account);

  console.log('\n=== Silicoin Miner Status ===\n');

  // Get chain data
  const [mineParams, totalMined, ethBalance, slcBalance, gasPrice] = await Promise.all([
    getMineParams(publicClient),
    getTotalMined(publicClient),
    getBalance(publicClient, minerAddr),
    getSlcBalance(publicClient, minerAddr),
    getGasPrice(publicClient),
  ]);

  const gasPriceGwei = Number(gasPrice) / 1e9;

  // Try to get SLC price from DexScreener
  let slcPriceUsd = 'N/A';
  let liquidityUsd = 'N/A';
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/0xbb572707D09eB2E80C835D3051097E5083D460Cc`);
    if (res.ok) {
      const data = await res.json();
      if (data.pairs && data.pairs.length > 0) {
        const pair = data.pairs[0];
        slcPriceUsd = `$${parseFloat(pair.priceUsd).toFixed(6)}`;
        liquidityUsd = `$${parseFloat(pair.liquidity?.usd || '0').toLocaleString()}`;
      }
    }
  } catch {}

  console.log(`Epoch:          ${mineParams.epoch}`);
  console.log(`Pool Live:      ${mineParams.poolLive ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Current Reward: ${mineParams.reward.toLocaleString()} SLC`);
  console.log(`Total Mined:    ${totalMined.toLocaleString()} / 5,000,000 SLC`);
  console.log(`Target (hex):   ${mineParams.target.toString(16)}`);
  console.log('');
  console.log(`Wallet:         ${minerAddr}`);
  console.log(`ETH Balance:   ${parseFloat(formatEther(ethBalance)).toFixed(6)} ETH`);
  console.log(`SLC Balance:   ${(Number(slcBalance) / 1e18).toFixed(2)} SLC`);
  console.log('');
  console.log(`Gas Price:      ${gasPriceGwei.toFixed(2)} gwei`);
  console.log(`SLC Price:      ${slcPriceUsd}`);
  console.log(`Liquidity:      ${liquidityUsd}`);
  console.log('');
  console.log(`Budget:         ${config.budgetEth} ETH`);
  console.log(`Max Gas:        ${config.maxGasGwei} gwei`);
  console.log(`Backend:        ${config.minerBackend}`);
  console.log('');
  console.log(`Wallet: ${minerAddr}`);
  console.log('');
  console.log('==============================\n');
}