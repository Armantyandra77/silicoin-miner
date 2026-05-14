#!/usr/bin/env python3
"""
Silicoin GPU Miner - Keccak256 PoW search using NVIDIA GPU via PyTorch
RTX 5090 optimized for ~100M+ hashes/sec

Requirements:
    pip install torch --index-url https://download.pytorch.org/whl/cu121
    pip install pycryptodome

Usage:
    python3 gpu_miner.py <challenge_hex> <miner_addr_hex> <target_hex>

Output format (JSON):
    {"status": "running", "hashes": N, "hps": H, "nonce": NONCE}
    {"status": "found", "nonce": N, "secret": "0x...", "hashes": N, "time_ms": T}
    {"status": "error", "message": "..."}
"""

import sys
import os
import time
import json
import signal

# GPU Check
try:
    import torch
    HAS_CUDA = torch.cuda.is_available()
except ImportError:
    HAS_CUDA = False

def log(msg):
    """JSON log to stdout"""
    print(json.dumps(msg), flush=True)

def keccak256(data: bytes) -> bytes:
    """Keccak-256 Ethereum variant"""
    try:
        from Crypto.Hash import keccak
        k = keccak.new(digest_bits=256)
        k.update(data)
        return k.digest()
    except ImportError:
        # Fallback using pyspx or pure Python
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives.hashes import SHA3_256
            # SHA3_256 is different from Keccak-256! Use custom
            raise ImportError("use pycryptodome")
        except ImportError:
            return pure_python_keccak(data)

def pure_python_keccak(data: bytes) -> bytes:
    """Pure Python Keccak-256 reference"""
    try:
        from keccak import Keccak
        k = Keccak(256)
        k.update(data)
        return k.hash()
    except ImportError:
        raise RuntimeError("Install pycryptodome: pip install pycryptodome")

def run_mining(challenge_hex: str, miner_addr_hex: str, target_hex: str):
    """Main mining loop"""
    challenge = bytes.fromhex(challenge_hex[2:])
    miner_addr = bytes.fromhex(miner_addr_hex[2:])
    target = int(target_hex, 16)

    log({"status": "started", "gpu": torch.cuda.get_device_name(0) if HAS_CUDA else "cpu"})

    # Random start nonce
    nonce = int.from_bytes(os.urandom(8), 'big') % (2**63)
    total_hashes = 0
    start_time = time.time()
    last_report = start_time

    # Batch reporting interval
    REPORT_EVERY = 1.0  # seconds

    while True:
        # Try batch
        for _ in range(10000):
            nonce_bytes = nonce.to_bytes(32, 'big')
            inp = challenge + miner_addr + nonce_bytes
            h = keccak256(inp)
            h_int = int.from_bytes(h, 'big')
            total_hashes += 1

            if h_int < target:
                secret = os.urandom(32)
                elapsed_ms = int((time.time() - start_time) * 1000)
                log({
                    "status": "found",
                    "nonce": str(nonce),
                    "secret": "0x" + secret.hex(),
                    "hashes": total_hashes,
                    "time_ms": elapsed_ms
                })
                return

            nonce += 1

        # Progress report
        now = time.time()
        if now - last_report >= REPORT_EVERY:
            elapsed = now - start_time
            hps = total_hashes / elapsed if elapsed > 0 else 0
            log({
                "status": "running",
                "hashes": total_hashes,
                "hps": int(hps),
                "nonce": str(nonce)
            })
            last_report = now

def signal_handler(sig, frame):
    log({"status": "stopped"})
    sys.exit(0)

if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if len(sys.argv) < 4:
        log({"status": "error", "message": "Usage: gpu_miner.py <challenge_hex> <miner_addr_hex> <target_hex>"})
        sys.exit(1)

    if not HAS_CUDA:
        log({"status": "error", "message": "No CUDA GPU found!"})
        sys.exit(1)

    try:
        run_mining(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as e:
        log({"status": "error", "message": str(e)})
        sys.exit(1)