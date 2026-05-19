import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Capital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string;
  population: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphData {
  nodes: Capital[];
  edges: GraphEdge[];
}

export interface RouteResult {
  path: string[];
  total_distance: number;
  nodes: Capital[];
}

const API = 'http://localhost:8000';

@Injectable({ providedIn: 'root' })
export class GraphService {
  private http = inject(HttpClient);

  getCapitals(): Observable<{ nodes: Capital[] }> {
    return this.http.get<{ nodes: Capital[] }>(`${API}/api/capitals`);
  }

  getGraph(): Observable<GraphData> {
    return this.http.get<GraphData>(`${API}/api/graph`);
  }

  calculateRoute(origin: string, destination: string): Observable<RouteResult> {
    return this.http.post<RouteResult>(`${API}/api/route`, { origin, destination });
  }
}
