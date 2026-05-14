import { PrivateKeyAccount } from 'viem/accounts';
import { TELEMETRY_URL, TELEMETRY_APIKEY } from './constants.js';
import type { ReportPayload, MiningStats } from './types.js';

export async function signReport(account: PrivateKeyAccount, payload: ReportPayload): Promise<string> {
  const body = JSON.stringify(payload);
  const signature = await account.signMessage({ message: body });
  return signature;
}

export async function sendReport(
  account: PrivateKeyAccount,
  stats: MiningStats,
  currentEpoch: number,
  budgetEth: bigint,
  hashrate: number,
  workers: number,
  lastWinTx?: `0x${string}`,
  lastWinBlock?: number,
  lastWinAt?: number
): Promise<void> {
  try {
    const payload: ReportPayload = {
      v: 1,
      addr: account.address.toLowerCase(),
      ts: Date.now(),
      chain: 1,
      name: process.env.MINER_NAME || 'unnamed',
      client: 'silicoin-miner/0.1.0',
      workers,
      hps: Math.round(hashrate),
      epoch: currentEpoch,
      wins: stats.wins,
      minedSlc: stats.slcMined.toString(),
      balanceSlc: stats.walletSlc.toString(),
      gasEth: stats.gasSpent.toString(),
      budgetEth: budgetEth.toString(),
      walletEth: stats.walletEth.toString(),
      lastWinTx: lastWinTx?.toString(),
      lastWinBlock: lastWinBlock,
      lastWinAt: lastWinAt,
    };

    const body = JSON.stringify(payload);
    const signature = await signReport(account, payload);

    await fetch(TELEMETRY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': TELEMETRY_APIKEY,
      },
      body: JSON.stringify({ report: body, signature }),
    });
  } catch {
    // Best-effort - ignore errors
  }
}