from __future__ import annotations

import json
import math
import ast
import os
import re
from typing import List, Optional

import networkx as nx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from backend.services import terrain
from scipy.spatial import Delaunay
from scipy.spatial import KDTree
import numpy as np
import networkx as nx

# ── GIS: ruta al JSON de capitales ──────────────────────────────────────────
_CAPITALS_PATH = os.path.join(os.path.dirname(__file__), "data", "capitals.json")


class QuadraticRequest(BaseModel):
    a: float = Field(default=1.0)
    b: float = Field(default=0.0)
    c: float = Field(default=0.0)
    x_min: float = Field(default=-10.0)
    x_max: float = Field(default=10.0)
    samples: int = Field(default=200, ge=20, le=1000)
    
class FunctionRequest(BaseModel):
    expression: str
    x_min: float = -10.0
    x_max: float = 10.0
    samples: int = Field(default=200, ge=20, le=1000)


class Point(BaseModel):
    x: float
    y: float


class FunctionResponse(BaseModel):
    points: List[Point]


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

class SurfaceRequest(BaseModel):
    a: float = 1.0
    b: float = 1.0
    c: float = 0.0
    size: float = 4.0
    segments: int = Field(default=60, ge=10, le=200)
    curve_a: Optional["CurveDefinition"] = None
    curve_b: Optional["CurveDefinition"] = None


class SurfaceExpressionRequest(BaseModel):
    expression: str = "x^2 - y^2"
    size: float = Field(default=4.0, gt=0.0, le=50.0)
    segments: int = Field(default=60, ge=10, le=200)


class CurveDefinition(BaseModel):
    x: str = "-2"
    y: str = "-2 + 4*t"
    z: str = "4 - (-2 + 4*t)^2"


SAFE_MATH_FUNCTIONS = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "exp": math.exp,
    "log": math.log,
    "sqrt": math.sqrt,
    "abs": abs,
}


ALLOWED_AST_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.USub,
    ast.UAdd,
)


app = FastAPI(title="Quadratic Function API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(terrain.router)


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


def normalize_expression(expression: str) -> str:
    normalized = expression.replace("^", "**")
    normalized = re.sub(r"(?<=\d)\s*(?=[A-Za-z(])", "*", normalized)
    normalized = re.sub(r"(?<=\))\s*(?=[\dA-Za-z(])", "*", normalized)
    return normalized


class SafeMathEvaluator(ast.NodeVisitor):
    def __init__(self, variables: dict[str, float]):
        self.variables = variables

    def visit_Expression(self, node: ast.Expression) -> float:
        return self.visit(node.body)

    def visit_BinOp(self, node: ast.BinOp) -> float:
        left = self.visit(node.left)
        right = self.visit(node.right)

        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow):
            return left**right

        raise ValueError("Operador no permitido")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> float:
        value = self.visit(node.operand)

        if isinstance(node.op, ast.UAdd):
            return +value
        if isinstance(node.op, ast.USub):
            return -value

        raise ValueError("Operador unario no permitido")

    def visit_Call(self, node: ast.Call) -> float:
        if not isinstance(node.func, ast.Name):
            raise ValueError("Solo se permiten funciones matematicas simples")

        function_name = node.func.id
        function = SAFE_MATH_FUNCTIONS.get(function_name)
        if function is None:
            raise ValueError(f"Funcion no permitida: {function_name}")

        args = [self.visit(arg) for arg in node.args]

        try:
            return float(function(*args))
        except Exception as error:
            raise ValueError(f"No se pudo evaluar la funcion {function_name}") from error

    def visit_Name(self, node: ast.Name) -> float:
        if node.id in self.variables:
            return float(self.variables[node.id])
        raise ValueError(f"Identificador no permitido: {node.id}")

    def visit_Constant(self, node: ast.Constant) -> float:
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError("Solo se permiten constantes numericas")

    def generic_visit(self, node: ast.AST):
        raise ValueError("La expresion contiene elementos no permitidos")


def evaluate_math_expression(expression: str, variable_name: str, variable_value: float) -> float:
    normalized_expression = normalize_expression(expression)

    try:
        parsed_tree = ast.parse(normalized_expression, mode="eval")
    except SyntaxError as error:
        raise ValueError(f"Expresion invalida: {expression}") from error

    for node in ast.walk(parsed_tree):
        if not isinstance(node, ALLOWED_AST_NODES):
            raise ValueError("La expresion contiene elementos no permitidos")

        if isinstance(node, ast.Name):
            if node.id not in {variable_name, "pi", "e", *SAFE_MATH_FUNCTIONS.keys()}:
                raise ValueError(f"Identificador no permitido: {node.id}")

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Solo se permiten funciones matematicas simples")
            if node.func.id not in SAFE_MATH_FUNCTIONS:
                raise ValueError(f"Funcion no permitida: {node.func.id}")

    evaluator = SafeMathEvaluator(
        {
            variable_name: variable_value,
            "pi": math.pi,
            "e": math.e,
        }
    )

    try:
        result = evaluator.visit(parsed_tree)
    except Exception as error:  # pragma: no cover - defensive guard for user expressions
        raise ValueError(f"No se pudo evaluar la expresion: {expression}") from error

    if not isinstance(result, (int, float)) or not math.isfinite(float(result)):
        raise ValueError("La expresion produce un valor no numerico")

    return float(result)


def evaluate_curve(curve: CurveDefinition, t_value: float) -> tuple[float, float, float]:
    x = evaluate_math_expression(curve.x, "t", t_value)
    y = evaluate_math_expression(curve.y, "t", t_value)
    z = evaluate_math_expression(curve.z, "t", t_value)
    return (x, y, z)


def evaluate_surface_expression(expression: str, x_val: float, y_val: float) -> float:
    """Evalua una expresion f(x, y) de forma segura usando el AST."""
    normalized = normalize_expression(expression)

    try:
        parsed_tree = ast.parse(normalized, mode="eval")
    except SyntaxError as error:
        raise ValueError(f"Expresion invalida: {expression}") from error

    allowed_names = {"x", "y", "pi", "e", *SAFE_MATH_FUNCTIONS.keys()}

    for node in ast.walk(parsed_tree):
        if not isinstance(node, ALLOWED_AST_NODES):
            raise ValueError("La expresion contiene elementos no permitidos")

        if isinstance(node, ast.Name) and node.id not in allowed_names:
            raise ValueError(f"Identificador no permitido: '{node.id}'. Solo se permiten x, y y funciones matematicas.")

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Solo se permiten funciones matematicas simples")
            if node.func.id not in SAFE_MATH_FUNCTIONS:
                raise ValueError(f"Funcion no permitida: {node.func.id}")

    evaluator = SafeMathEvaluator({"x": x_val, "y": y_val, "pi": math.pi, "e": math.e})

    try:
        result = evaluator.visit(parsed_tree)
    except Exception as error:
        raise ValueError(f"No se pudo evaluar la expresion: {expression}") from error

    if not isinstance(result, (int, float)) or not math.isfinite(float(result)):
        raise ValueError("La expresion produce un valor no numerico o infinito")

    return float(result)


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

@app.post("/api/function/evaluate", response_model=FunctionResponse)
def evaluate_function(payload: FunctionRequest) -> FunctionResponse:
    x_min = min(payload.x_min, payload.x_max)
    x_max = max(payload.x_min, payload.x_max)
    samples = payload.samples

    if x_max == x_min:
        x_max = x_min + 1

    step = (x_max - x_min) / (samples - 1)

    points = []

    for i in range(samples):
        x = x_min + i * step

        try:
            y = evaluate_math_expression(payload.expression, "x", x)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        points.append(Point(x=x, y=y))

    return FunctionResponse(points=points)

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

@app.post("/api/surface/paraboloid")
def paraboloid_surface(payload: SurfaceRequest):

    a = payload.a
    b = payload.b
    c = payload.c
    size = payload.size
    segments = payload.segments

    positions = []
    indices = []

    # 🔵 generar puntos
    for i in range(segments + 1):
        for j in range(segments + 1):

            x = (i / segments - 0.5) * size
            y = (j / segments - 0.5) * size

            z = a * x * x - b * y * y + c

            positions.extend([x, y, z])

    # 🔴 generar triángulos
    for i in range(segments):
        for j in range(segments):

            a1 = i * (segments + 1) + j
            b1 = a1 + 1
            c1 = a1 + (segments + 1)
            d1 = c1 + 1

            indices.extend([a1, c1, b1])
            indices.extend([b1, c1, d1])

    return {
        "positions": positions,
        "indices": indices
    }

@app.post("/api/surface/ruled")
def ruled_surface(payload: SurfaceRequest):
    segments = payload.segments
    curve_a = payload.curve_a or CurveDefinition(
        x="-2",
        y="-2 + 4*t",
        z="4 - (-2 + 4*t)^2",
    )
    curve_b = payload.curve_b or CurveDefinition(
        x="2",
        y="-2 + 4*t",
        z="4 - (-2 + 4*t)^2",
    )

    positions: list[float] = []
    indices: list[int] = []
    curve_a_positions: list[float] = []
    curve_b_positions: list[float] = []

    for i in range(segments + 1):
        t = i / segments

        try:
            ax, ay, az = evaluate_curve(curve_a, t)
            bx, by, bz = evaluate_curve(curve_b, t)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        curve_a_positions.extend([ax, ay, az])
        curve_b_positions.extend([bx, by, bz])

        for j in range(segments + 1):
            s = j / segments

            x = ax + (bx - ax) * s
            y = ay + (by - ay) * s
            z = az + (bz - az) * s

            positions.extend([x, y, z])

    for i in range(segments):
        for j in range(segments):
            a1 = i * (segments + 1) + j
            b1 = a1 + 1
            c1 = a1 + (segments + 1)
            d1 = c1 + 1

            indices.extend([a1, c1, b1])
            indices.extend([b1, c1, d1])

    return {
        "positions": positions,
        "indices": indices,
        "curve_a_positions": curve_a_positions,
        "curve_b_positions": curve_b_positions,
    }


@app.post("/api/surface/expression")
def surface_from_expression(payload: SurfaceExpressionRequest):
    """Genera una malla 3D evaluando z = f(x, y) de forma segura."""
    size = payload.size
    segments = payload.segments

    # Validar la expresion antes de iterar
    try:
        evaluate_surface_expression(payload.expression, 0.0, 0.0)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    positions: list[float] = []
    indices: list[int] = []

    for i in range(segments + 1):
        for j in range(segments + 1):
            x = (i / segments - 0.5) * size
            y = (j / segments - 0.5) * size

            try:
                z = evaluate_surface_expression(payload.expression, x, y)
            except ValueError:
                z = 0.0  # Singularidades puntuales no rompen la malla

            positions.extend([x, y, z])

    for i in range(segments):
        for j in range(segments):
            a1 = i * (segments + 1) + j
            b1 = a1 + 1
            c1 = a1 + (segments + 1)
            d1 = c1 + 1

            indices.extend([a1, c1, b1])
            indices.extend([b1, c1, d1])

    return {"positions": positions, "indices": indices}


# ─────────────────────────────────────────────────────────────────────────────
# GIS – Grafo de capitales de provincia
# ─────────────────────────────────────────────────────────────────────────────

class RouteRequest(BaseModel):
    origin: str
    destination: str


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en km entre dos puntos WGS84 usando la fórmula Haversine."""
    R = 6_371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _load_capitals() -> list[dict]:
    with open(_CAPITALS_PATH, encoding="utf-8") as f:
        return json.load(f)["nodes"]


def _build_nx_graph(capitals: list[dict]) -> nx.Graph:
    """Construye un grafo conectando cada capital a sus K vecinos más cercanos."""
    
    NUM_VECINOS = 3  
    
    G = nx.Graph()
    for cap in capitals:
        G.add_node(cap["id"], **cap)

    points = np.array([[c["lng"], c["lat"]] for c in capitals])
    
    # 2. Usamos KDTree (que en versiones nuevas de SciPy ya está optimizado en C)
    tree = KDTree(points)

    distances, indices = tree.query(points, k=NUM_VECINOS + 1)
    indices_list = indices.tolist()

    for i, cap in enumerate(capitals):
        for j in range(1, NUM_VECINOS + 1):
            # Le decimos al linter que ignore su falsa suposición aquí
            neighbor_idx = int(indices[i][j])  # type: ignore
            neighbor = capitals[neighbor_idx]

            if not G.has_edge(cap["id"], neighbor["id"]):
                dist = _haversine(cap["lat"], cap["lng"], neighbor["lat"], neighbor["lng"])
                G.add_edge(cap["id"], neighbor["id"], weight=round(dist, 3))
                
    return G


@app.get("/api/capitals")
def get_capitals():
    """Devuelve el catálogo completo de capitales de provincia con sus coordenadas."""
    return {"nodes": _load_capitals()}


@app.get("/api/graph")
def get_graph():
    """Devuelve el grafo optimizado: nodos + las aristas calculadas por Delaunay."""
    capitals = _load_capitals()
    
    # Usamos la misma función de arriba para no duplicar la lógica matemática
    G = _build_nx_graph(capitals)
    
    # Extraemos las aristas del grafo de NetworkX al formato JSON que espera Angular
    edges = [
        {"source": u, "target": v, "weight": data["weight"]}
        for u, v, data in G.edges(data=True)
    ]
    
    return {"nodes": capitals, "edges": edges}


@app.post("/api/route")
def get_route(req: RouteRequest):
    """
    Calcula la ruta óptima entre dos capitales usando el algoritmo de Dijkstra (NetworkX).
    Devuelve la secuencia de nodos, la distancia total y los datos de cada nodo intermedio.
    """
    capitals = _load_capitals()
    cap_map = {c["id"]: c for c in capitals}

    if req.origin not in cap_map:
        raise HTTPException(status_code=400, detail=f"Capital de origen desconocida: '{req.origin}'")
    if req.destination not in cap_map:
        raise HTTPException(status_code=400, detail=f"Capital de destino desconocida: '{req.destination}'")
    if req.origin == req.destination:
        node = cap_map[req.origin]
        return {"path": [req.origin], "total_distance": 0.0, "nodes": [node]}

    G = _build_nx_graph(capitals)

    try:
        path: list[str] = nx.dijkstra_path(G, req.origin, req.destination, weight="weight")
        total_km: float = nx.dijkstra_path_length(G, req.origin, req.destination, weight="weight")
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=404, detail="No existe ruta entre los nodos seleccionados")

    return {
        "path": path,
        "total_distance": round(total_km, 2),
        "nodes": [cap_map[nid] for nid in path],
    }