__kernel void keccak_search(
    __global const u8* challenge,     // 32 bytes
    __global const u8* miner_addr,    // 32 bytes (padded to 32)
    __global const u8* target,        // 32 bytes big-endian
    ulong start_nonce,
    ulong batch_size,
    __global u64* result_nonce,       // output: nonce if found, 0 if not
    __global u8* result_secret        // output: 32 bytes secret if found
) {
    ulong gid = get_global_id(0);
    ulong nonce = start_nonce + gid;

    // Build hash input: challenge || miner_addr || nonce
    u8 input[96];

    // Copy challenge (32 bytes)
    for (int i = 0; i < 32; i++) input[i] = challenge[i];

    // Copy miner_addr (32 bytes)
    for (int i = 0; i < 32; i++) input[32 + i] = miner_addr[i];

    // Copy nonce as 32 bytes big-endian
    for (int i = 0; i < 8; i++) input[64 + i] = (nonce >> (56 - i * 8)) & 0xFF;
    for (int i = 8; i < 32; i++) input[64 + i] = 0;

    // Keccak-256
    u8 hash[32];
    keccak_256(input, 96, hash);

    // Compare hash < target (as big-endian uint256)
    bool valid = true;
    for (int i = 0; i < 32; i++) {
        if (hash[i] < target[i]) { valid = false; break; }
        if (hash[i] > target[i]) { valid = true; break; }
    }

    if (valid) {
        *result_nonce = nonce;
        // Generate secret from hash of nonce
        for (int i = 0; i < 32; i++) result_secret[i] = hash[i];
    }
}

// Simplified keccak-256 implementation for GPU
void keccak_256(__global const u8* input, int len, __global u8* output) {
    // This is a reference - proper implementation needs full keccak-f1600
    // For production, use a proven keccak OpenCL kernel
    // Using sha3_generic or similar
    int i, j, x, y;
    u64 state[25];
    u8 queue[200];
    int rate, rateByte, inputByte;

    // Initialize
    for (i = 0; i < 25; i++) state[i] = 0;
    rate = 1088;
    rateByte = rate / 8;
    inputByte = len * 8;

    // Absorb
    for (i = 0; i < len; i++) queue[i] = input[i];
    queue[len] = 0x01;
    for (i = len + 1; i < rateByte; i++) queue[i] = 0;
    queue[rateByte - 1] |= 0x80;

    // Keccak-f1600 permutation would go here
    // For now this is a stub - use a proper OpenCL keccak implementation
}