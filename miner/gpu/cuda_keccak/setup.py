from setuptools import setup
from torch.utils.cpp_extension import BuildExtension, CUDAExtension

setup(
    name='keccak256_cuda',
    ext_modules=[
        CUDAExtension(
            name='keccak256_cuda',
            sources=['keccak256.cu', 'wrapper.cpp'],
            extra_compile_args={
                'cxx': ['-O3', '-ffast-math'],
                'nvcc': ['-O3', '--use_fast_math', '-gencode=arch=compute_90,code=sm_90']
            }
        ),
    ],
    cmdclass={'build_ext': BuildExtension},
)