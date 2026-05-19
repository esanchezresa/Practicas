import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface FunctionEvaluateRequest {
  expression: string;
  x_min: number;
  x_max: number;
  samples: number;
}

export interface FunctionEvaluateResponse {
  points: { x: number; y: number }[];
}

@Injectable({ providedIn: 'root' })
export class FunctionApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;

  evaluate(payload: FunctionEvaluateRequest): Observable<FunctionEvaluateResponse> {
    return this.http.post<FunctionEvaluateResponse>(`${this.baseUrl}/api/function/evaluate`, payload);
  }
}
