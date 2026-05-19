from pathlib import Path

import math
import numpy as np
import rasterio
import requests as _requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from rasterio.warp import transform_bounds
from scipy.ndimage import gaussian_filter, zoom

router = APIRouter(prefix="/terrain", tags=["terrain"])

# ── WMS providers ────────────────────────────────────────────────────────────
_WMS = {
    "satellite": {
        "url": "https://www.ign.es/wms-inspire/pnoa-ma",
        "layer": "OI.OrthoimageCoverage",
        "label": "Satélite PNOA (IGN)",
    },
    "road": {
        "url": "https://www.ign.es/wms-inspire/ign-base",
        "layer": "IGNBaseTodo",
        "label": "Mapa base IGN",
    },
    "topo": {
        "url": "https://www.ign.es/wms-inspire/mapa-raster",
        "layer": "MTN",
        "label": "Topográfico MTN",
    },
}

# Cache en memoria: evita repetir llamadas WMS mientras dura el proceso
_texture_cache: dict[str, bytes] = {}

_TIF = Path(__file__).parent.parent / "data" / "PNOA_MDT05_ETRS89_HU30_0038_LID.tif"


# ─────────────────────────────────────────────────────────────
# CARGA Y PROCESADO DEL TERRENO
# ─────────────────────────────────────────────────────────────
def _load_elevation(step: int) -> tuple[np.ndarray, object]:
    if step <= 0:
        raise ValueError("step debe ser > 0")

    if not _TIF.exists():
        raise FileNotFoundError(f"TIF no encontrado: {_TIF}")

    try:
        with rasterio.open(_TIF) as src:
            elev = src.read(1).astype(np.float32)
            nd = src.nodata
            transform = src.transform
    except Exception as e:
        raise RuntimeError(f"Error abriendo raster: {e}")

    # ── 1. nodata → NaN ─────────────────────────────
    if nd is not None:
        elev[elev == nd] = np.nan

    # ── 2. eliminar outliers extremos — 1.5σ corta picos LIDAR agresivamente
    mean = np.nanmean(elev)
    std = np.nanstd(elev)

    elev = np.clip(elev, mean - 1.5 * std, mean + 1.5 * std)

    # ── 3. downsample correcto (antes del suavizado)
    if step > 1:
        elev = zoom(elev, 1 / step, order=1)

    # ── 4. rellenar NaNs para evitar artefactos en el blur
    valid_mask = np.isfinite(elev)

    if not np.any(valid_mask):
        raise RuntimeError("Raster sin datos válidos")

    fill_value = np.nanmean(elev)
    elev_filled = np.where(valid_mask, elev, fill_value)

    # ── 5. suavizado fuerte: sigma=5 sobre el grid ya submuestreado
    #       equivale a ~200m de radio en el terreno real (step=8, 5m/px)
    elev = gaussian_filter(elev_filled, sigma=5.0)

    # ── 6. restaurar NaNs originales
    elev[~valid_mask] = np.nan

    return elev, transform


# ─────────────────────────────────────────────────────────────
# ENDPOINT TERRENO
# ─────────────────────────────────────────────────────────────
@router.get("")
def get_terrain(step: int = 8):
    try:
        elev, transform = _load_elevation(step)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    rows, cols = elev.shape
    # Pixel size after downsampling: original resolution × step
    cell_size_m = abs(transform.a) * step if hasattr(transform, "a") else None

    # nan_to_num replaces NaN/±inf with 0 before converting to nested list
    data = np.nan_to_num(elev, nan=0.0, posinf=0.0, neginf=0.0).tolist()

    return {
        "tif": str(_TIF),
        "exists": _TIF.exists(),
        "shape": [rows, cols],
        "width": cols,
        "height": rows,
        "cell_size_m": cell_size_m,
        "data": data,
    }


# ─────────────────────────────────────────────────────────────
# COASTLINE (simplificado y estable)
# ─────────────────────────────────────────────────────────────
@router.get("/coastline")
def get_coastline(step: int = 8, subsample: int = 3):
    try:
        elev, _ = _load_elevation(step)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    land = np.isfinite(elev) & (elev > 1.0)
    sea = ~land

    def _shift(arr, dr, dc):
        shifted = np.roll(np.roll(arr, dr, axis=0), dc, axis=1)
        if dr > 0:
            shifted[:dr, :] = False
        if dr < 0:
            shifted[dr:, :] = False
        if dc > 0:
            shifted[:, :dc] = False
        if dc < 0:
            shifted[:, dc:] = False
        return shifted

    sea_nb = (
        _shift(sea, 1, 0)
        | _shift(sea, -1, 0)
        | _shift(sea, 0, 1)
        | _shift(sea, 0, -1)
    )

    rows, cols = np.where(land & sea_nb)

    if len(rows) == 0:
        return {"points": []}

    idx = np.arange(0, len(rows), subsample)
    rows, cols = rows[idx], cols[idx]

    return {
        "points": [[int(c), int(r)] for c, r in zip(cols, rows)]
    }


# ─────────────────────────────────────────────────────────────
# TEXTURA WMS
# ─────────────────────────────────────────────────────────────
@router.get("/texture")
def get_texture(type: str = "satellite"):
    """
    Descarga una imagen de mapa del servicio WMS del IGN que cubre exactamente
    el área del GeoTIFF de terreno y la devuelve como PNG.
    Tipos disponibles: satellite | road | topo
    """
    if type not in _WMS:
        raise HTTPException(status_code=400, detail=f"Tipo '{type}' no válido. Usa: {list(_WMS.keys())}")

    if type in _texture_cache:
        return Response(content=_texture_cache[type], media_type="image/png",
                        headers={"Cache-Control": "max-age=3600"})

    if not _TIF.exists():
        raise HTTPException(status_code=404, detail=f"TIF no encontrado: {_TIF}")

    # ── Leer bounds nativos del GeoTIFF y proyectar a WGS84 ──────────────────
    with rasterio.open(_TIF) as src:
        native_bounds = src.bounds
        native_crs    = src.crs
        # Dimensiones reales en metros (CRS nativo es UTM → unidades en metros)
        width_m  = native_bounds.right - native_bounds.left
        height_m = native_bounds.top   - native_bounds.bottom

    # Proyectar a WGS84 para la llamada WMS (CRS:84 garantiza orden lon/lat)
    west, south, east, north = transform_bounds(native_crs, "EPSG:4326", *native_bounds)

    # ── Calcular dimensiones de la textura conservando proporción ─────────────
    # Los datos están en UTM (metros): la proporción es directa
    aspect   = width_m / height_m
    target   = 1024
    if aspect >= 1.0:
        tex_w = target
        tex_h = max(64, int(target / aspect))
    else:
        tex_h = target
        tex_w = max(64, int(target * aspect))

    # ── Llamada WMS ──────────────────────────────────────────────────────────
    cfg    = _WMS[type]
    params = {
        "SERVICE":     "WMS",
        "VERSION":     "1.3.0",
        "REQUEST":     "GetMap",
        "LAYERS":      cfg["layer"],
        "STYLES":      "",
        "CRS":         "CRS:84",          # lon/lat sin ambigüedad de ejes
        "BBOX":        f"{west},{south},{east},{north}",
        "WIDTH":       str(tex_w),
        "HEIGHT":      str(tex_h),
        "FORMAT":      "image/png",
        "TRANSPARENT": "FALSE",
    }

    try:
        resp = _requests.get(cfg["url"], params=params, timeout=45)
        resp.raise_for_status()
    except _requests.Timeout:
        raise HTTPException(status_code=504, detail="El servicio WMS del IGN tardó demasiado. Inténtalo de nuevo.")
    except _requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Error contactando WMS: {exc}")

    content_type = resp.headers.get("Content-Type", "")
    if "image" not in content_type:
        raise HTTPException(
            status_code=502,
            detail=f"WMS devolvió respuesta no-imagen ({content_type}): {resp.text[:300]}"
        )

    _texture_cache[type] = resp.content
    return Response(content=resp.content, media_type="image/png",
                    headers={"Cache-Control": "max-age=3600"})