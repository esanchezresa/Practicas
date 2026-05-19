import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface QuadraticRequest {
  a: number;
  b: number;
  c: number;
  x_min: number;
  x_max: number;
  samples: number;
}

export interface QuadraticResponse {
  points: { x: number; y: number }[];
  discriminant: number;
  has_real_roots: boolean;
  roots: number[];
  vertex_x: number | null;
  vertex_y: number | null;
}

export interface CoefficientsFromPointsRequest {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
  x_min: number;
  x_max: number;
}

export interface CoefficientsResponse {
  a: number;
  b: number;
  c: number;
  discriminant: number;
  roots: number[];
  vertex_x: number | null;
  vertex_y: number | null;
}

@Injectable({ providedIn: 'root' })
export class QuadraticApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;

  calculate(payload: QuadraticRequest): Observable<QuadraticResponse> {
    return this.http.post<QuadraticResponse>(`${this.baseUrl}/api/quadratic/calculate`, payload);
  }

  fitCoefficientsFromPoints(payload: CoefficientsFromPointsRequest): Observable<CoefficientsResponse> {
    return this.http.post<CoefficientsResponse>(`${this.baseUrl}/api/quadratic/fit-from-points`, payload);
  }
}
