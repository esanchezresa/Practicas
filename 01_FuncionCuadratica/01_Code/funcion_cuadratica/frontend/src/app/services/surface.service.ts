import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class SurfaceService {

  private http = inject(HttpClient);

  getSurface(mode: string, a: number, b: number, c: number) {

    const params = new HttpParams()
      .set('mode', mode)
      .set('a', a)
      .set('b', b)
      .set('c', c);

    return this.http.get<any>(
      'http://localhost:8000/api/surface/paraboloid',
      { params }
    );
  }
}