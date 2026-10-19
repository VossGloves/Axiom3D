# id: scipy-optimize-param-solve
# title: Solve scalar parameters with scipy optimize
# tags: scipy, optimize, solver, fitting, parameter
# description: Use scipy.optimize to solve a procedural scalar parameter when direct numpy algebra is inconvenient.

from scipy import optimize


def run():
    result = optimize.root_scalar(lambda x: x * x - 2.0, bracket=[1.0, 2.0])
    return {"root": round(float(result.root), 6), "iterations": int(result.iterations)}
