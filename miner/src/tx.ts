import { createWalletClient, http, Chain } from 'viem';
import { PrivateKeyAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { encodeCommitData, encodeRevealData } from './chain.js';
import type { EnvConfig } from './types.js';
import { SLC_ADDRESS, ANCHOR_SAFE_DISTANCE } from './constants.js';

// Send commit transaction
export async function sendCommitTx(
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  commitment: `0x${string}`,
  targetBlock: number
): Promise<`0x${string}` | null> {
  const hash = await walletClient.sendTransaction({
    to: SLC_ADDRESS,
    data: encodeCommitData(commitment),
    gasPrice: await walletClient.getGasPrice(),
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
  });
  return hash;
}

// Send reveal transaction
export async function sendRevealTx(
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  nonce: bigint,
  secret: `0x${string}`,
  anchorBlock: bigint
): Promise<`0x${string}` | null> {
  const hash = await walletClient.sendTransaction({
    to: SLC_ADDRESS,
    data: encodeRevealData(nonce, secret, anchorBlock),
    gasPrice: await walletClient.getGasPrice(),
  });
  return hash;
}

// Submit commit+reveal as a pair (mempool mode)
export async function submitCommitRevealMempool(
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  commitment: `0x${string}`,
  nonce: bigint,
  secret: `0x${string}`,
  anchorBlock: number,
  publicClient: any // we don't use publicClient here for basic mempool send
): Promise<{ success: boolean; commitTx?: `0x${string}`; revealTx?: `0x${string}`; error?: string }> {
  try {
    // Send commit tx
    const commitHash = await sendCommitTx(walletClient, account, commitment, anchorBlock);
    if (!commitHash) {
      return { success: false, error: 'Commit tx not sent' };
    }

    // Wait for commit to be included
    // In production you'd poll for receipt and check block number
    // For now we just return the tx hash
    
    // Send reveal tx (should be in next block)
    const revealHash = await sendRevealTx(walletClient, account, nonce, secret, anchorBlock);
    
    return {
      success: true,
      commitTx: commitHash,
      revealTx: revealHash || undefined,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Check if commit was included in expected block
export async function verifyCommitInclusion(
  publicClient: any,
  commitTxHash: `0x${string}`,
  expectedBlock: number
): Promise<boolean> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: commitTxHash });
    return Number(receipt.blockNumber) === expectedBlock;
  } catch {
    return false;
  }
}

// Estimate gas for commit
export async function estimateCommitGas(publicClient: any): Promise<bigint> {
  return 50000n; // ~50k gas for commit
}

// Estimate gas for reveal
export async function estimateRevealGas(publicClient: any): Promise<bigint> {
  return 200000n; // ~200k gas for reveal
}