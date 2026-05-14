// Silicoin Contract Address (ERC-20 + PoW contract on Ethereum mainnet)
export const SLC_ADDRESS = '0xbb572707D09eB2E80C835D3051097E5083D460Cc' as const;

// Contract ABI - only functions we need
export const CONTRACT_ABI = [
  {
    inputs: [],
    name: 'mineParams',
    outputs: [
      { name: 'epochSeed', type: 'bytes32' },
      { name: 'target', type: 'uint256' },
      { name: 'reward', type: 'uint256' },
      { name: 'epoch', type: 'uint8' },
      { name: 'poolLive', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    name: 'commit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nonce', type: 'uint256' },
      { name: 'secret', type: 'bytes32' },
      { name: 'anchorBlock', type: 'uint256' },
    ],
    name: 'reveal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalMined',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// RPC Endpoints
export const DEFAULT_RPC = 'https://eth.llamarpc.com';

// Telemetry endpoint
export const TELEMETRY_URL = 'https://svwobzsafxhhndcojmia.supabase.co/functions/v1/report';
export const TELEMETRY_APIKEY = 'sb_publishable_jdBUhy2g2k1BB0oOtNy04Q_Bj9P_B1v';

// Mining constants
export const COMMIT_WINDOW = 1; // reveal must be in commitBlock + 1
export const ANCHOR_SAFE_DISTANCE = 2; // use latest - 2 for anchor block
export const DEFAULT_MAX_GAS_GWEI = 20;
export const DEFAULT_BUDGET_ETH = '0.02';
export const DEFAULT_WORKERS = 0; // 0 = auto-detect

// SLC token decimals
export const SLC_DECIMALS = 18n;