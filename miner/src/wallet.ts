import { createWalletClient, http, PrivateKeyAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import type { EnvConfig } from './types.js';

export function createWallet(config: EnvConfig) {
  const account: PrivateKeyAccount = privateKeyToAccount(config.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(config.rpcUrl),
  });
  return { account, walletClient };
}

export function getAddress(account: PrivateKeyAccount): `0x${string}` {
  return account.address;
}