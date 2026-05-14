#!/usr/bin/env python3
"""
Silicoin GPU Miner v4 - True CUDA Keccak-256
Compiled CUDA kernel for RTX 5090 acceleration.

Usage:
    python3 gpu_miner.py <challenge_hex> <miner_addr_hex> <target_hex>

Requirements:
    pip install torch --index-url https://download.pytorch.org/whl/cu121
    cd cuda_keccak && pip install -e .
"""

import sys
import os
import time
import json
import signal

# Global target for CPU fallback
G_TARGET = 0

def log(msg):
    print(json.dumps(msg), flush=True)

def signal_handler(sig, frame):
    log({"status": "stopped"})
    sys.exit(0)


def mine_cuda(challenge_hex: str, miner_addr_hex: str, target_hex: str):
    """GPU mining using compiled CUDA kernel"""
    global G_TARGET
    G_TARGET = int(target_hex, 16)
    
    import torch
    
    if not torch.cuda.is_available():
        log({"status": "error", "message": "CUDA not available"})
        return
    
    gpu_name = torch.cuda.get_device_name(0)
    log({"status": "started", "gpu": gpu_name})
    
    challenge = bytes.fromhex(challenge_hex[2:])
    miner_addr = bytes.fromhex(miner_addr_hex[2:])
    target = int(target_hex, 16)
    
    # Upload constant data to GPU
    chal_t = torch.tensor(list(challenge), dtype=torch.uint8, device='cuda')
    addr_t = torch.tensor(list(miner_addr), dtype=torch.uint8, device='cuda')
    
    # Try to load compiled CUDA extension
    try:
        import keccak256_cuda
        HAS_KERNEL = True
        log({"status": "running", "mode": "cuda_kernel", "gpu": gpu_name})
    except ImportError:
        HAS_KERNEL = False
        log({"status": "running", "mode": "cuda_tensor", "gpu": gpu_name})
    
    BATCH = 1 << 20  # 1M nonces per batch
    nonce = int.from_bytes(os.urandom(8), 'big')
    total_hashes = 0
    start_time = time.time()
    last_report = start_time
    
    # Nonce buffer on CPU (use int64 - arange uint32 not supported on CPU)
    nonce_base = torch.arange(BATCH, dtype=torch.int64)
    
    from Crypto.Hash import keccak
    
    while True:
        # Generate nonce batch on CPU as int64, move to CUDA
        nonce_batch = (nonce_base + nonce).to('cuda')
        
        if HAS_KERNEL:
            # Use compiled CUDA kernel
            nonce_t = nonce_batch.to('cuda')
            results = keccak256_cuda.keccak256(chal_t, addr_t, nonce_t, target)
            
            # Check results on CPU
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
        else:
            # CPU fallback (still batched)
            base = challenge + miner_addr
            found = False
            
            for i in range(BATCH):
                nonce_bytes = (nonce + i).to_bytes(32, 'big')
                k = keccak.new(digest_bits=256)
                k.update(base + nonce_bytes)
                h_int = int.from_bytes(k.digest(), 'big')
                total_hashes += 1
                
                if h_int < target:
                    secret = os.urandom(32)
                    elapsed_ms = int((time.time() - start_time) * 1000)
                    log({
                        "status": "found",
                        "nonce": str(nonce + i),
                        "secret": "***" + secret.hex(),
                        "hashes": total_hashes,
                        "time_ms": elapsed_ms
                    })
                    return
        
        total_hashes += BATCH
        nonce += BATCH
        
        now = time.time()
        if now - last_report >= 0.5:
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
        mine_cuda(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as e:
        import traceback
        log({"status": "error", "message": str(e), "trace": traceback.format_exc()})
        sys.exit(1)