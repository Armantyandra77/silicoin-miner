#!/usr/bin/env python3
"""
GPU Miner wrapper — spawns native CUDA binary for true GPU acceleration.
No pybind11, no torch dependency for hashing. Pure C++ CUDA kernel.
"""

import sys
import os
import subprocess
import json
import signal

def log(msg):
    print(json.dumps(msg), flush=True)

def signal_handler(sig, frame):
    log({"status": "stopped"})
    sys.exit(0)

def find_cuda_binary():
    candidates = [
        os.environ.get("CUDA_MINER_BIN"),
        os.path.join(os.path.dirname(__file__), "../bin/slc-cuda"),
        os.path.join(os.getcwd(), "bin/slc-cuda"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def main():
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if len(sys.argv) < 6:
        log({"status": "error", "message": "Usage: gpu_miner.py <challenge32> <miner20> <target32> <startNonceU64> <batchSize>"})
        sys.exit(1)

    binary = find_cuda_binary()
    if not binary:
        log({"status": "error", "message": "CUDA binary not found. Run: npm run build:cuda"})
        sys.exit(1)

    # Arguments: challenge(32 hex) miner(20 hex) target(32 hex) start(10u) batch(10u)
    # But JS sends 0x prefix, CUDA binary expects raw hex
    ch = sys.argv[1]
    miner = sys.argv[2]
    target = sys.argv[3]
    start = sys.argv[4]
    batch = sys.argv[5]

    # Strip 0x prefix if present
    if ch.startswith('0x'): ch = ch[2:]
    if miner.startswith('0x'): miner = miner[2:]
    if target.startswith('0x'): target = target[2:]

    env = os.environ.copy()
    result = subprocess.run(
        [binary, ch, miner, target, start, batch],
        capture_output=True,
        text=True,
        env=env,
        timeout=600
    )

    if result.returncode != 0:
        log({"status": "error", "message": f"CUDA miner exited {result.returncode}: {result.stderr}"})
        sys.exit(1)

    # Parse last JSON line from stdout
    lines = [l for l in result.stdout.strip().split('\n') if l.strip()]
    if not lines:
        log({"status": "error", "message": "No output from CUDA miner"})
        sys.exit(1)

    try:
        msg = json.loads(lines[-1])
    except json.JSONDecodeError:
        log({"status": "error", "message": f"Invalid JSON from CUDA miner: {lines[-1]}"})
        sys.exit(1)

    if msg.get('type') == 'error':
        log({"status": "error", "message": msg.get('error', 'unknown')})
        sys.exit(1)

    if msg.get('type') == 'found':
        log({
            "status": "found",
            "nonce": msg.get('nonce'),
            "secret": "***",
            "hashes": int(msg.get('tried', 0)),
            "time_ms": int(float(msg.get('ms', 0))),
            "hps": int(float(msg.get('hps', 0))),
            "device": msg.get('device')
        })
    else:
        log({
            "status": "running",
            "hashes": int(msg.get('tried', 0)),
            "hps": int(float(msg.get('hps', 0))),
            "device": msg.get('device'),
            "blocks": msg.get('blocks'),
            "threads": msg.get('threads')
        })

if __name__ == "__main__":
    main()