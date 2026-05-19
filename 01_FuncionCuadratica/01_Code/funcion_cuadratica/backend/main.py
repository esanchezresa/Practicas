from __future__ import annotations

import math
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class QuadraticRequest(BaseModel):
    a: float = Field(default=1.0)
    b: float = Field(default=0.0)
    c: float = Field(default=0.0)
    x_min: float = Field(default=-10.0)
    x_max: float = Field(default=10.0)
    samples: int = Field(default=200, ge=20, le=1000)


class Point(BaseModel):
    x: float
    y: float


class QuadraticResponse(BaseModel):
    points: List[Point]
    discriminant: float
    has_real_roots: bool
    roots: List[float]
    vertex_x: Optional[float]
    vertex_y: Optional[float]


class CoefficientsFromPointsRequest(BaseModel):
    """Request to compute a, b, c from 3 points on a parabola."""
    p1: Point  # (x1, y1)
    p2: Point  # (x2, y2)
    p3: Point  # (x3, y3)
    x_min: float  # domain min
    x_max: float  # domain max


class CoefficientsResponse(BaseModel):
    """Response with computed coefficients and recalculated data."""
    a: float
    b: float
    c: float
    discriminant: float
    roots: List[float]
    vertex_x: Optional[float]
    vertex_y: Optional[float]


app = FastAPI(title="Quadratic Function API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def quadratic(a: float, b: float, c: float, x: float) -> float:
    return (a * (x**2)) + (b * x) + c


def solve_roots(a: float, b: float, c: float, discriminant: float) -> List[float]:
    if a == 0:
        if b == 0:
            return []
        return [(-c) / b]

    if discriminant < 0:
        return []

    if discriminant == 0:
        return [(-b) / (2 * a)]

    sqrt_d = math.sqrt(discriminant)
    return [((-b) + sqrt_d) / (2 * a), ((-b) - sqrt_d) / (2 * a)]


def solve_coefficients_from_three_points(
    x1: float, y1: float, x2: float, y2: float, x3: float, y3: float
) -> tuple[float, float, float] | None:
    """
    Solve a, b, c from three points on a parabola y = ax^2 + bx + c.
    Uses Cramer's rule on the Vandermonde system.
    Returns (a, b, c) or None if system is singular.
    """
    # Build Vandermonde matrix
    A = [
        [x1 * x1, x1, 1],
        [x2 * x2, x2, 1],
        [x3 * x3, x3, 1],
    ]
    B = [y1, y2, y3]

    # Compute determinant of A
    det_a = (
        A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
        - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
        + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    )

    if not math.isfinite(det_a) or abs(det_a) < 1e-12:
        return None

    # Cramer's rule for a
    det_a_a = (
        B[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
        - A[0][1] * (B[1] * A[2][2] - A[1][2] * B[2])
        + A[0][2] * (B[1] * A[2][1] - A[1][1] * B[2])
    )

    # Cramer's rule for b
    det_a_b = (
        A[0][0] * (B[1] * A[2][2] - A[1][2] * B[2])
        - B[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
        + A[0][2] * (A[1][0] * B[2] - B[1] * A[2][0])
    )

    # Cramer's rule for c
    det_a_c = (
        A[0][0] * (A[1][1] * B[2] - B[1] * A[2][1])
        - A[0][1] * (A[1][0] * B[2] - B[1] * A[2][0])
        + B[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    )

    a = det_a_a / det_a
    b = det_a_b / det_a
    c = det_a_c / det_a

    return (a, b, c)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/quadratic/calculate", response_model=QuadraticResponse)
def calculate_quadratic(payload: QuadraticRequest) -> QuadraticResponse:
    a = payload.a
    b = payload.b
    c = payload.c

    x_min = min(payload.x_min, payload.x_max)
    x_max = max(payload.x_min, payload.x_max)
    samples = payload.samples

    if x_max == x_min:
        x_max = x_min + 1

    step = (x_max - x_min) / (samples - 1)
    points = [
        Point(x=(x_min + (i * step)), y=quadratic(a, b, c, x_min + (i * step)))
        for i in range(samples)
    ]

    discriminant = (b**2) - (4 * a * c)
    roots = solve_roots(a, b, c, discriminant)

    if a == 0:
        vertex_x = None
        vertex_y = None
    else:
        vertex_x = (-b) / (2 * a)
        vertex_y = quadratic(a, b, c, vertex_x)

    return QuadraticResponse(
        points=points,
        discriminant=discriminant,
        has_real_roots=(discriminant >= 0),
        roots=roots,
        vertex_x=vertex_x,
        vertex_y=vertex_y,
    )


@app.post("/api/quadratic/fit-from-points", response_model=CoefficientsResponse)
def fit_coefficients_from_points(payload: CoefficientsFromPointsRequest) -> CoefficientsResponse:
    """
    Compute quadratic coefficients (a, b, c) from 3 points on the curve.
    Used by the interactive drag-based editor.
    """
    x1, y1 = payload.p1.x, payload.p1.y
    x2, y2 = payload.p2.x, payload.p2.y
    x3, y3 = payload.p3.x, payload.p3.y

    result = solve_coefficients_from_three_points(x1, y1, x2, y2, x3, y3)
    if result is None:
        # Degenerate case: return default coefficients
        a, b, c = 1.0, 0.0, 0.0
    else:
        a, b, c = result

    # Recalculate all derived values
    discriminant = (b**2) - (4 * a * c)
    roots = solve_roots(a, b, c, discriminant)

    if a == 0:
        vertex_x = None
        vertex_y = None
    else:
        vertex_x = (-b) / (2 * a)
        vertex_y = quadratic(a, b, c, vertex_x)

    return CoefficientsResponse(
        a=a,
        b=b,
        c=c,
        discriminant=discriminant,
        roots=roots,
        vertex_x=vertex_x,
        vertex_y=vertex_y,
    )
