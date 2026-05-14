import { createPublicClient, createWalletClient, http, custom, encodeFunctionData, hexToBigInt, toHex } from 'viem';
import { mainnet } from 'viem/chains';
import { SLC_ADDRESS, CONTRACT_ABI } from './constants.js';
import type { MineParams } from './types.js';

export function createClients(rpcUrl: string) {
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });
  return { publicClient };
}

export async function getMineParams(publicClient: ReturnType<typeof createPublicClient>): Promise<MineParams> {
  const result = await publicClient.readContract({
    address: SLC_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'mineParams',
    args: [],
  }) as [string, bigint, bigint, number, boolean];

  return {
    epochSeed: result[0] as `0x${string}`,
    target: result[1],
    reward: result[2],
    epoch: Number(result[3]),
    poolLive: result[4],
  };
}

export async function getLatestBlock(publicClient: ReturnType<typeof createPublicClient>): Promise<number> {
  return Number(await publicClient.getBlockNumber());
}

export async function getBlockHash(publicClient: ReturnType<typeof createPublicClient>, blockNumber: number): Promise<`0x${string}`> {
  const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) });
  return block.hash as `0x${string}`;
}

export async function getGasPrice(publicClient: ReturnType<typeof createPublicClient>): Promise<bigint> {
  return await publicClient.getGasPrice();
}

export async function getBalance(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`): Promise<bigint> {
  return await publicClient.getBalance({ address });
}

export async function getSlcBalance(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`): Promise<bigint> {
  return await publicClient.readContract({
    address: SLC_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'balanceOf',
    args: [address],
  }) as bigint;
}

export async function getTotalMined(publicClient: ReturnType<typeof createPublicClient>): Promise<bigint> {
  return await publicClient.readContract({
    address: SLC_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'totalMined',
    args: [],
  }) as bigint;
}

export function encodeCommitData(commitment: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: CONTRACT_ABI,
    functionName: 'commit',
    args: [commitment],
  });
}

export function encodeRevealData(nonce: bigint, secret: `0x${string}`, anchorBlock: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: CONTRACT_ABI,
    functionName: 'reveal',
    args: [nonce, secret, anchorBlock],
  });
}