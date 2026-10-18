# id: scipy-ckdtree-nearest
# title: Find nearest points with scipy cKDTree
# tags: scipy, spatial, ckdtree, nearest, search
# description: Build a scipy cKDTree over point samples and query nearest neighbors for large search workloads.

import numpy as np
from scipy.spatial import cKDTree


def run():
    points = np.array([[0.0, 0.0], [1.0, 1.0], [3.0, 3.0]])
    tree = cKDTree(points)
    distance, index = tree.query([0.9, 1.1])
    return {"index": int(index), "distance": round(float(distance), 4)}
