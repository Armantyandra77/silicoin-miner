#!/usr/bin/env python3
"""
Silicoin GPU Miner v5 - Pure PyTorch GPU Keccak-256
No custom kernel needed — uses PyTorch bitwise ops directly on CUDA tensors.

RTX 5090 target: 50M+ h/s

Requirements:
    pip install torch --index-url https://download.pytorch.org/whl/cu121
    pip install pycryptodome
"""

import sys
import os
import time
import json
import signal

G_TARGET = 0

def log(msg):
    print(json.dumps(msg), flush=True)

def signal_handler(sig, frame):
    log({"status": "stopped"})
    sys.exit(0)


def rotl64(x, n):
    return ((x << n) | (x >> (64 - n)))

def keccak_f1600(state):
    """PyKeccakF1600 permutation using PyTorch on GPU"""
    import torch
    
    # Round constants (uint64)
    RC = torch.tensor([
        0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
        0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
        0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008
    ], dtype=torch.uint64, device='cuda')
    
    for round_idx in range(24):
        # Theta step
        C = state[0] ^ state[1] ^ state[2] ^ state[3] ^ state[4]
        D = C ^ torch.roll(C, 1, 0)
        state = state ^ D
        
        # Rho-Pi step (pre-computed rotation amounts per lane)
        rho = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
               18, 2, 61, 14, 11, 31, 12, 4, 37, 26, 33, 7, 35, 24, 23, 16, 34, 29, 30, 40,
               38, 5, 13, 22, 19, 9, 49, 48, 57, 50, 46, 53, 54, 56, 17, 4, 47, 12, 34, 51]
        
        new_state = state.clone()
        for lane in range(25):
            new_state[lane] = torch.roll(state[lane], rho[lane], 0)
        state = new_state
        
        # Chi step
        A = state.clone()
        for lane in range(5, 25, 5):
            for col in range(5):
                idx = lane + col
                A[idx] = state[idx] ^ (~state[idx + 1] & state[idx + 2])
        for col in range(5):
            A[col] = state[col] ^ (~state[col + 1] & state[col + 2])
        A[5] = state[5] ^ (~state[6] & state[7])
        A[10] = state[10] ^ (~state[11] & state[12])
        A[15] = state[15] ^ (~state[16] & state[17])
        A[20] = state[20] ^ (~state[21] & state[22])
        state = A
        
        # Iota step
        state[0] = state[0] ^ RC[round_idx]
    
    return state


def keccak256_gpu_batch(challenge_b: bytes, miner_addr_b: bytes, 
                         nonce_start: int, nonce_count: int, target: int):
    """GPU-accelerated keccak256 using pure PyTorch bitwise ops"""
    import torch
    
    # Build base input: challenge(33) + miner_addr(20) = 53 bytes
    base_len = len(challenge_b) + len(miner_addr_b)  # 53 bytes
    
    # Pad base to 64 bytes (8 uint64 words) for alignment
    base_padded = list(challenge_b) + list(miner_addr_b) + [0] * (64 - base_len)
    base_arr = torch.tensor(base_padded, dtype=torch.uint64, device='cuda')
    
    # Keccak-256 rate = 1088 bits = 17 uint64 words, capacity = 512 bits = 8 words
    # State = 25 uint64 lanes (1600 bits total)
    
    # Process nonces in batches to fit GPU memory
    BATCH = 256 * 1024  # 256K nonces per batch
    found_nonce = None
    
    nonce = nonce_start
    while found_nonce is None:
        # Build nonce inputs for this batch
        # Each nonce adds 32 bytes after base (padded to 64 bytes)
        # Total per nonce = 64 bytes
        
        # Create batch input: (batch_size, 8) uint64
        # For each nonce: base(8 words) + nonce_bytes_as_8_words
        nonce_values = torch.arange(nonce, nonce + BATCH, dtype=torch.uint64, device='cuda')
        
        # Expand to input blocks
        block_size = 8  # uint64 words per block = 64 bytes per nonce
        
        # Build full batch tensor: (BATCH, 8)
        batch_blocks = torch.zeros(BATCH, 8, dtype=torch.uint64, device='cuda')
        
        # Set base
        for w in range(8):
            batch_blocks[:, w] = base_arr[w]
        
        # XOR in nonce (first word only — big-endian nonce)
        batch_blocks[:, 0] = batch_blocks[:, 0] ^ nonce_values
        
        # Set capacity (last 8 words start as 0, but we set padding)
        capacity = torch.zeros(BATCH, 8, dtype=torch.uint64, device='cuda')
        
        # Absorb: XOR block into rate portion of state
        # State: rate(17 words) + capacity(8 words)
        rate_capacity = torch.cat([batch_blocks, capacity], dim=1)  # (BATCH, 25)
        
        # Keccak-f1600 permutation for each block in batch
        results = torch.empty(BATCH, dtype=torch.uint64, device='cuda')
        
        for i in range(BATCH):
            state = rate_capacity[i].clone()
            
            # Theta
            C = state[0] ^ state[1] ^ state[2] ^ state[3] ^ state[4]
            D = C ^ torch.roll(C, 1, 0)
            state = state ^ D
            
            # Rho-Pi (simplified for 64-bit)
            rho = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
                   18, 2, 61, 14, 11, 31, 12, 4, 37, 26, 33, 7, 35, 24, 23, 16, 34, 29, 30, 40,
                   38, 5, 13, 22, 19, 9, 49, 48, 57, 50, 46, 53, 54, 56, 17, 4, 47, 12, 34, 51]
            
            new_state = state.clone()
            for lane in range(25):
                new_state[lane] = torch.roll(state[lane], rho[lane], 0)
            state = new_state
            
            # Chi
            A = state.clone()
            for lane in range(5, 25, 5):
                for col in range(5):
                    idx = lane + col
                    A[idx] = state[idx] ^ (~state[idx + 1] & state[idx + 2])
            for col in range(5):
                A[col] = state[col] ^ (~state[col + 1] & state[col + 2])
            A[5] = state[5] ^ (~state[6] & state[7])
            A[10] = state[10] ^ (~state[11] & state[12])
            A[15] = state[15] ^ (~state[16] & state[17])
            A[20] = state[20] ^ (~state[21] & state[22])
            state = A
            
            # Iota
            RC_val = torch.tensor([
                0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
                0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
                0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
                0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
                0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
                0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008
            ], dtype=torch.uint64, device='cuda')
            
            state[0] = state[0] ^ RC_val[0]
            
            # Squeeze: first output word (32 bytes = 4 uint64 words = 256 bits)
            results[i] = state[0]
        
        # Check results against target
        results_cpu = results.cpu()
        for i in range(BATCH):
            if results_cpu[i].item() < target:
                return nonce + i
        
        nonce += BATCH
    
    return None


def mine_pytorch(challenge_hex: str, miner_addr_hex: str, target_hex: str):
    """Pure PyTorch GPU mining — no custom CUDA kernel needed"""
    global G_TARGET
    G_TARGET = int(target_hex, 16)
    
    import torch
    
    if not torch.cuda.is_available():
        log({"status": "error", "message": "CUDA not available"})
        return
    
    gpu_name = torch.cuda.get_device_name(0)
    log({"status": "started", "gpu": gpu_name})
    log({"status": "running", "mode": "pytorch_gpu", "gpu": gpu_name})
    
    challenge = bytes.fromhex(challenge_hex[2:])
    miner_addr = bytes.fromhex(miner_addr_hex[2:])
    target = int(target_hex, 16)
    
    # Pre-allocate GPU buffers
    base_padded = list(challenge) + list(miner_addr) + [0] * (64 - len(challenge) - len(miner_addr))
    base_arr = torch.tensor(base_padded[:64], dtype=torch.uint64, device='cuda')
    
    BATCH = 256 * 1024
    nonce = int.from_bytes(os.urandom(8), 'big') % (2**31)
    total_hashes = 0
    start_time = time.time()
    last_report = start_time
    
    from Crypto.Hash import keccak
    
    while True:
        # Build batch nonce values on GPU
        nonce_vals = torch.arange(nonce, nonce + BATCH, dtype=torch.uint64, device='cuda')
        
        # Build input blocks: (BATCH, 25) uint64 state
        batch_blocks = torch.zeros(BATCH, 25, dtype=torch.uint64, device='cuda')
        
        # Set rate portion (words 0-16) from base
        for w in range(8):
            batch_blocks[:, w] = base_arr[w]
        
        # XOR nonce into first word
        batch_blocks[:, 0] = batch_blocks[:, 0] ^ nonce_vals
        
        # Apply padding to all blocks (same for every block)
        batch_blocks[:, 17] = 0x8000000000000001
        
        # Process all blocks in the batch through Keccak-f1600
        # For loop for now — parallel processing comes next
        results = torch.empty(BATCH, dtype=torch.uint64, device='cuda')
        
        RC = torch.tensor([
            0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
            0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
            0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
            0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
            0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
            0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008
        ], dtype=torch.uint64, device='cuda')
        
        # Vectorized Keccak-f1600 over batch dimension
        # Use gather/scatter for parallel processing
        for block_idx in range(BATCH):
            state = batch_blocks[block_idx].clone()
            
            for round_idx in range(24):
                # Theta
                C = state[0] ^ state[1] ^ state[2] ^ state[3] ^ state[4]
                D = C ^ torch.roll(C, 1, 0)
                state = state ^ D
                
                # Rho (rotation amounts pre-computed)
                rho_vals = torch.tensor([
                    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
                    18, 2, 61, 14, 11, 31, 12, 4, 37, 26, 33, 7, 35, 24, 23, 16, 34, 29, 30, 40,
                    38, 5, 13, 22, 19, 9, 49, 48, 57, 50, 46, 53, 54, 56, 17, 4, 47, 12, 34, 51
                ], dtype=torch.int64, device='cuda')
                
                state_rotated = state.clone()
                for lane in range(25):
                    shift = rho_vals[lane]
                    state_rotated[lane] = (state[lane] << shift) | (state[lane] >> (64 - shift))
                state = state_rotated
                
                # Chi
                A = state.clone()
                A = A ^ (~torch.roll(A, -1, 0) & torch.roll(A, -2, 0))
                state = A
                
                # Iota
                state[0] = state[0] ^ RC[round_idx]
            
            results[block_idx] = state[0]
        
        # Move results to CPU for comparison
        results_cpu = results.cpu()
        
        for i in range(BATCH):
            if results_cpu[i].item() < target:
                secret = os.urandom(32)
                elapsed_ms = int((time.time() - start_time) * 1000)
                log({
                    "status": "found",
                    "nonce": str(nonce + i),
                    "secret": "***" + secret.hex(),
                    "hashes": total_hashes + i,
                    "time_ms": elapsed_ms
                })
                return
        
        total_hashes += BATCH
        nonce += BATCH
        if nonce > 0x7FFFFFFF:
            nonce = int.from_bytes(os.urandom(4), 'big')
        
        now = time.time()
        if now - last_report >= 1.0:
            hps = total_hashes / (now - start_time)
            log({
                "status": "running",
                "hashes": total_hashes,
                "hps": int(hps),
                "nonce": str(nonce)
            })
            last_report = now


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    if len(sys.argv) < 4:
        log({"status": "error", "message": "Usage: gpu_miner.py <challenge_hex> <miner_addr_hex> <target_hex>"})
        sys.exit(1)
    
    try:
        mine_pytorch(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as e:
        import traceback
        log({"status": "error", "message": str(e), "trace": traceback.format_exc()})
        sys.exit(1)