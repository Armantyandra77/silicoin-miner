#include <torch/extension.h>
#include <cuda.h>
#include <cuda_runtime.h>

// Keccak-256 round constants
__device__ __constant__ uint64_t RC[24] = {
    0x0000000000000001UL, 0x0000000000008082UL, 0x800000000000808aUL, 0x8000000080008000UL,
    0x000000000000808bUL, 0x0000000080000001UL, 0x8000000080008081UL, 0x8000000000008009UL,
    0x000000000000008aUL, 0x0000000000000088UL, 0x0000000080008009UL, 0x000000008000000aUL,
    0x000000008000808bUL, 0x800000000000008bUL, 0x8000000000008089UL, 0x8000000000008003UL,
    0x8000000000008002UL, 0x8000000000000080UL, 0x000000000000800aUL, 0x800000008000000aUL,
    0x8000000080008081UL, 0x8000000000008080UL, 0x0000000080000001UL, 0x8000000080008008UL
};

// Rotation macros
#define ROTL64(x, n) (((x) << (n)) | ((x) >> (64 - (n))))

// Keccak-256 theta
__device__ void theta(uint64_t S[25], uint64_t& Da, uint64_t& De, uint64_t& Di, uint64_t& Do, uint64_t& Du) {
    uint64_t BCa = S[0] ^ S[5] ^ S[10] ^ S[15] ^ S[20];
    uint64_t BCe = S[1] ^ S[6] ^ S[11] ^ S[16] ^ S[21];
    uint64_t BCi = S[2] ^ S[7] ^ S[12] ^ S[17] ^ S[22];
    uint64_t BCo = S[3] ^ S[8] ^ S[13] ^ S[18] ^ S[23];
    uint64_t BCq = S[4] ^ S[9] ^ S[14] ^ S[19] ^ S[24];
    Da = BCq ^ ROTL64(BCe, 1);
    De = BCa ^ ROTL64(BCi, 1);
    Di = BCe ^ ROTL64(BCo, 1);
    Do = BCi ^ ROTL64(BCq, 1);
    Du = BCo ^ ROTL64(BCa, 1);
}

// Keccak-256 rho + pi
__device__ void rho_pi(uint64_t S[25], uint64_t Da, uint64_t De, uint64_t Di, uint64_t Do, uint64_t Du) {
    uint64_t Aba = S[0] ^ Da;
    uint64_t Abe = S[1] ^ De;
    uint64_t Abi = S[2] ^ Di;
    uint64_t Abo = S[3] ^ Do;
    uint64_t Abq = S[4] ^ Du;
    uint64_t Aca = S[5] ^ Da;
    uint64_t Ace = S[6] ^ De;
    uint64_t Aci = S[7] ^ Di;
    uint64_t Aco = S[8] ^ Do;
    uint64_t Acq = S[9] ^ Du;
    uint64_t AGA = S[10] ^ Da;
    uint64_t Age = S[11] ^ De;
    uint64_t Agi = S[12] ^ Di;
    uint64_t Ago = S[13] ^ Do;
    uint64_t Agq = S[14] ^ Du;
    uint64_t Aka = S[15] ^ Da;
    uint64_t Ake = S[16] ^ De;
    uint64_t Aki = S[17] ^ Di;
    uint64_t Ako = S[18] ^ Do;
    uint64_t Akq = S[19] ^ Du;
    uint64_t Ama = S[20] ^ Da;
    uint64_t Ame = S[21] ^ De;
    uint64_t Ami = S[22] ^ Di;
    uint64_t Amo = S[23] ^ Do;
    uint64_t Amq = S[24] ^ Du;

    // Rho
    uint64_t Ba = Aba;
    uint64_t Be = ROTL64(Abe, 1);
    uint64_t Bi = ROTL64(Abi, 10);
    uint64_t Bo = ROTL64(Abo, 7);
    uint64_t Bq = ROTL64(Abq, 18);
    uint64_t Ca = Aca ^ Be;
    uint64_t Ce = Age ^ Bi;
    uint64_t Ci = Ago ^ Bo;
    uint64_t Co = Akq ^ Bq;
    uint64_t Cq = Aba ^ Ba;
    uint64_t Ga = Aka ^ Ce;
    uint64_t Ge = Amo ^ Ci;
    uint64_t Gi = Ace ^ Co;
    uint64_t Go = Abi ^ Cq;
    uint64_t Gq = Age ^ Ca;
    uint64_t Ka = Ama ^ Ci;
    uint64_t Ke = Ako ^ Co;
    uint64_t Ki = Ake ^ Cq;
    uint64_t Ko = Abe ^ Ca;
    uint64_t Kq = Agi ^ Ce;
    uint64_t Sa = Ago ^ Co;
    uint64_t Se = Aki ^ Cq;
    uint64_t Si = Aca ^ Ca;
    uint64_t So = Age ^ Ce;
    uint64_t Sq = Amq ^ Ci;

    // Pi
    S[0] = Ba;
    S[1] = Ce;
    S[2] = Gi;
    S[3] = Ko;
    S[4] = Amq;
    S[5] = Ca;
    S[6] = Ge;
    S[7] = Ki;
    S[8] = So;
    S[9] = Abe;
    S[10] = Ga;
    S[11] = Ke;
    S[12] = Si;
    S[13] = Bo;
    S[14] = Kq;
    S[15] = Ka;
    S[16] = Se;
    S[17] = Ci;
    S[18] = Aca ^ Ba;
    S[19] = Gq;
    S[20] = Ama;
    S[21] = Ake ^ Ce;
    S[22] = Aki ^ Ge;
    S[23] = Aco;
    S[24] = Agq;
}

// Keccak-256 chi
__device__ void chi(uint64_t S[25]) {
    uint64_t Aba = S[0];
    uint64_t Abe = S[1];
    uint64_t Abi = S[2];
    uint64_t Abo = S[3];
    uint64_t Abq = S[4];
    uint64_t Aca = S[5];
    uint64_t Ace = S[6];
    uint64_t Aci = S[7];
    uint64_t Aco = S[8];
    uint64_t Acq = S[9];
    uint64_t AGA = S[10];
    uint64_t Age = S[11];
    uint64_t Agi = S[12];
    uint64_t Ago = S[13];
    uint64_t Agq = S[14];
    uint64_t Aka = S[15];
    uint64_t Ake = S[16];
    uint64_t Aki = S[17];
    uint64_t Ako = S[18];
    uint64_t Akq = S[19];
    uint64_t Ama = S[20];
    uint64_t Ame = S[21];
    uint64_t Ami = S[22];
    uint64_t Amo = S[23];
    uint64_t Amq = S[24];

    S[0] = Aba ^ (~Abe & Aci);
    S[1] = Abe ^ (~Aci & Aco);
    S[2] = Aci ^ (~Aco & Acq);
    S[3] = Aco ^ (~Acq & AGA);
    S[4] = Acq ^ (~AGA & Age);
    S[5] = Aca ^ (~Age & Agi);
    S[6] = Age ^ (~Agi & Ago);
    S[7] = Agi ^ (~Ago & Agq);
    S[8] = Ago ^ (~Agq & Aka);
    S[9] = Agq ^ (~Aka & Ake);
    S[10] = AGA ^ (~Ake & Aki);
    S[11] = Ake ^ (~Aki & Ako);
    S[12] = Aki ^ (~Ako & Akq);
    S[13] = Ako ^ (~Akq & Ama);
    S[14] = Akq ^ (~Ama & Ame);
    S[15] = Aka ^ (~Ame & Ami);
    S[16] = Ame ^ (~Ami & Amo);
    S[17] = Ami ^ (~Amo & Amq);
    S[18] = Amo ^ (~Amq & Aba);
    S[19] = Amq ^ (~Aba & Abe);
    S[20] = Ama ^ (~Abe & Abi);
    S[21] = Abe ^ (~Abi & Abo);
    S[22] = Abi ^ (~Abo & Abq);
    S[23] = Abo ^ (~Abq & Aca);
    S[24] = Abq ^ (~Aca & Ace);
}

__global__ void keccak256_batch_kernel(
    const uint8_t* __restrict__ challenge,
    const uint8_t* __restrict__ miner_addr,
    const uint32_t* __restrict__ nonces,
    uint64_t* __restrict__ results,
    uint32_t batch_size,
    uint64_t target
) {
    uint32_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    uint32_t stride = gridDim.x * blockDim.x;

    for (uint32_t i = idx; i < batch_size; i += stride) {
        // Initialize state
        uint64_t S[25];
        #pragma unroll
        for (int j = 0; j < 25; j++) S[j] = 0;

        // Build input: challenge(33) + miner_addr(20) + nonce(32) = 85 bytes
        uint8_t input[85];
        #pragma unroll
        for (int b = 0; b < 33; b++) input[b] = challenge[b];
        #pragma unroll
        for (int b = 0; b < 20; b++) input[33 + b] = miner_addr[b];

        // nonce as uint32 (4 bytes), bytes 4-31 = 0
        uint32_t nv = nonces[i];
        input[53] = (uint8_t)(nv & 0xFF);
        input[54] = (uint8_t)((nv >> 8) & 0xFF);
        input[55] = (uint8_t)((nv >> 16) & 0xFF);
        input[56] = (uint8_t)((nv >> 24) & 0xFF);
        // bytes 57-84 already 0

        // Absorb into state (rate = 136 bytes = 17 words, capacity = 64 bits = 1 word)
        #pragma unroll
        for (int w = 0; w < 17; w++) {
            uint64_t val = 0;
            #pragma unroll
            for (int b = 0; b < 8; b++) {
                val |= ((uint64_t)input[w * 8 + b]) << (8 * b);
            }
            S[w] ^= val;
        }
        S[17] ^= 0x8000000000000001UL;  // padding

        // Keccak-f1600 (24 rounds)
        #pragma unroll
        for (int round = 0; round < 24; round++) {
            uint64_t Da, De, Di, Do, Du;
            theta(S, Da, De, Di, Do, Du);
            rho_pi(S, Da, De, Di, Do, Du);
            chi(S);
            S[0] ^= RC[round];
        }

        // Squeeze: output first 32 bytes (words 0,1,2,3)
        uint64_t h0 = S[0];
        uint64_t h1 = S[1];
        uint64_t h2 = S[2];
        uint64_t h3 = S[3];

        // Combine into uint256 result (big-endian: h0 is most significant)
        // For comparison: treat h0|h1 as high 64 bits, h2|h3 as low 64 bits
        uint64_t high = h0;
        uint64_t low = (h1 << 32) | (h2 >> 32);

        results[i] = high;
    }
}

// Host wrapper
torch::Tensor keccak256_cuda(
    torch::Tensor challenge,   // (33,) uint8 CUDA
    torch::Tensor miner_addr,  // (20,) uint8 CUDA
    torch::Tensor nonces,      // (N,) uint32 CUDA
    uint64_t target
) {
    int batch_size = nonces.size(0);
    const int blocks = 256;
    const int threads = 256;
    
    auto results = torch::empty({batch_size}, torch::kCUDA);
    
    keccak256_batch_kernel<<<blocks, threads>>>(
        challenge.data_ptr<uint8_t>(),
        miner_addr.data_ptr<uint8_t>(),
        nonces.data_ptr<uint32_t>(),
        results.data_ptr<uint64_t>(),
        batch_size,
        target
    );
    
    cudaDeviceSynchronize();
    return results;
}

PYBIND11_MODULE(keccak256_cuda, m) {
    m.def("keccak256", &keccak256_cuda, "Keccak-256 CUDA kernel");
}