// wrapper.cpp - Simple C wrapper for the CUDA keccak256 kernel
// This bypasses pybind11 type conversion issues by using raw C ABI

#include <torch/extension.h>
#include <cuda.h>
#include <cuda_runtime.h>
#include <stdint.h>

// Declared in keccak256.cu
torch::Tensor keccak256_cuda(
    torch::Tensor challenge,
    torch::Tensor miner_addr,
    torch::Tensor nonces,
    uint64_t target
);

// C function with raw pointers — no pybind11 type magic
extern "C" void keccak256(
    uint8_t* challenge_bytes,
    uint8_t* miner_addr_bytes,
    uint32_t* nonces,
    uint64_t* results,
    uint32_t batch_size,
    uint64_t target
) {
    // Convert raw pointers to torch tensors
    torch::Tensor chal_t = torch::from_blob(
        challenge_bytes, {33}, torch::kUInt8
    ).to(torch::kCUDA).clone();
    
    torch::Tensor addr_t = torch::from_blob(
        miner_addr_bytes, {20}, torch::kUInt8
    ).to(torch::kCUDA).clone();
    
    torch::Tensor nonce_t = torch::from_blob(
        nonces, {batch_size}, torch::kInt32
    ).to(torch::kCUDA).clone();
    
    torch::Tensor result_t = keccak256_cuda(chal_t, addr_t, nonce_t, target);
    
    // Copy results back
    uint64_t* result_ptr = result_t.cpu().data_ptr<uint64_t>();
    for (uint32_t i = 0; i < batch_size; i++) {
        results[i] = result_ptr[i];
    }
}