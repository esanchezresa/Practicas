import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface TerrainData {
  width:       number;
  height:      number;
  cell_size_m: number;
  data:        number[][];
}

export interface CoastlineData {
  /** Array of [col, row] grid-index pairs */
  points: [number, number][];
}

@Injectable({ providedIn: 'root' })
export class TerrainService {
  private readonly http = inject(HttpClient);
  private readonly base = 'http://localhost:8000/terrain';

  getTerrain(step = 8): Observable<TerrainData> {
    return this.http.get<TerrainData>(`${this.base}?step=${step}`);
  }

  getCoastline(step = 8, subsample = 3): Observable<CoastlineData> {
    return this.http.get<CoastlineData>(
      `${this.base}/coastline?step=${step}&subsample=${subsample}`
    );
  }
}
