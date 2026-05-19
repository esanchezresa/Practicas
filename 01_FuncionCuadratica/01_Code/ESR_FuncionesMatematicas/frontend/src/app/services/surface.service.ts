import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface RuledCurveInput {
  x: string;
  y: string;
  z: string;
}

export interface SurfaceRequest {
  a: number;
  b: number;
  c: number;
  size: number;
  segments: number;
  curve_a?: RuledCurveInput;
  curve_b?: RuledCurveInput;
}

export interface SurfaceExpressionRequest {
  expression: string;
  size?: number;
  segments?: number;
}

@Injectable({
  providedIn: 'root',
})
export class SurfaceService {
  private http = inject(HttpClient);

  getSurface(mode: string, request: SurfaceRequest) {
    const url =
      mode === 'function'
        ? 'http://localhost:8000/api/surface/paraboloid'
        : 'http://localhost:8000/api/surface/ruled';

    return this.http.post<any>(url, request);
  }

  getSurfaceFromExpression(expression: string, size = 4, segments = 60) {
    const request: SurfaceExpressionRequest = { expression, size, segments };
    return this.http.post<any>('http://localhost:8000/api/surface/expression', request);
  }
}
