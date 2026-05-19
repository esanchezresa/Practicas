import { Component, DestroyRef, inject } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';

import { AppHeaderComponent } from './components/app-header/app-header.component';
import { QuadraticChartComponent } from './components/quadratic-chart/quadratic-chart.component';
import { QuadraticControlsComponent } from './components/quadratic-controls/quadratic-controls.component';
import { QuadraticApiService } from './services/quadratic-api.service';

// 👇 AÑADIDO (IMPORTANTE)
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true, // 👈 ASEGÚRATE de que existe
  imports: [
    AppHeaderComponent,
    QuadraticControlsComponent,
    QuadraticChartComponent,
    RouterOutlet // 👈 AÑADIDO
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly api = inject(QuadraticApiService);
  private readonly destroyRef = inject(DestroyRef);
  private activeRequestId = 0;
  private readonly sampleCount = 240;

  readonly title = 'Interfaz gráfica de funcion cuadrática';
  readonly description =
    'Ajusta los parametros a, b y c para explorar la funcion f(x) = ax^2 + bx + c. Puedes escribir valores o usar las barras deslizantes.';

  readonly form = new FormGroup({
    a: new FormControl<number>(1, { nonNullable: true }),
    b: new FormControl<number>(0, { nonNullable: true }),
    c: new FormControl<number>(0, { nonNullable: true }),
    xMin: new FormControl<number>(-5, { nonNullable: true }),
    xMax: new FormControl<number>(5, { nonNullable: true })
  });

  isLoading = false;
  hasError = false;

  discriminant = 0;
  roots: number[] = [];
  vertexX: number | null = 0;
  vertexY: number | null = 0;

  curvePoints: Array<{ x: number; y: number }> = this.buildPoints(1, 0, 0, -5, 5, this.sampleCount);

  constructor() {
    this.applyLocalComputation();
    this.fetchQuadratic();

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.applyLocalComputation();
    });

    this.form.valueChanges
      .pipe(
        debounceTime(140),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.fetchQuadratic();
      });
  }

  get rootsDisplay(): string {
    if (this.roots.length === 0) {
      return 'No reales';
    }
    return this.roots.map((item) => this.formatNumber(item, 4)).join(', ');
  }

  formatNumber(value: number | null, digits = 4): string {
    if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
      return 'No definido';
    }
    return value.toFixed(digits);
  }

  private fetchQuadratic(): void {
    const requestId = ++this.activeRequestId;

    const raw = this.form.getRawValue();
    const payload = {
      a: raw.a,
      b: raw.b,
      c: raw.c,
      x_min: raw.xMin,
      x_max: raw.xMax,
      samples: this.sampleCount
    };

    this.isLoading = true;
    this.hasError = false;

    this.api
      .calculate(payload)
      .pipe(
        finalize(() => {
          if (requestId === this.activeRequestId) {
            this.isLoading = false;
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          if (requestId !== this.activeRequestId) {
            return;
          }

          this.hasError = false;
          this.discriminant = response.discriminant;
          this.roots = response.roots;
          this.vertexX = response.vertex_x;
          this.vertexY = response.vertex_y;
          this.curvePoints = response.points;
        },
        error: () => {
          if (requestId !== this.activeRequestId) {
            return;
          }

          this.hasError = true;
          this.applyLocalComputation();
        }
      });
  }

  private applyLocalComputation(): void {
    const raw = this.form.getRawValue();
    const points = this.buildPoints(raw.a, raw.b, raw.c, raw.xMin, raw.xMax, this.sampleCount);
    const discriminant = (raw.b ** 2) - (4 * raw.a * raw.c);

    this.discriminant = discriminant;
    this.roots = this.solveRoots(raw.a, raw.b, raw.c, discriminant);

    if (raw.a === 0) {
      this.vertexX = null;
      this.vertexY = null;
    } else {
      this.vertexX = (-raw.b) / (2 * raw.a);
      this.vertexY = (raw.a * (this.vertexX ** 2)) + (raw.b * this.vertexX) + raw.c;
    }

    this.curvePoints = points;
  }

  private buildPoints(
    a: number,
    b: number,
    c: number,
    xMinInput: number,
    xMaxInput: number,
    samples: number
  ): { x: number; y: number }[] {
    const xMin = Math.min(xMinInput, xMaxInput);
    const xMaxOriginal = Math.max(xMinInput, xMaxInput);
    const xMax = xMaxOriginal === xMin ? xMin + 1 : xMaxOriginal;
    const step = (xMax - xMin) / (samples - 1);

    return Array.from({ length: samples }, (_, index) => {
      const x = xMin + (index * step);
      return {
        x,
        y: (a * (x ** 2)) + (b * x) + c
      };
    });
  }

  // Handler for chart interactive edits (draggable handles)
  // Note: coefficients are already calculated by backend, now we just need to fetch the full response
  onChartCoefficientsChange(payload: { a: number; b: number; c: number; xMin: number; xMax: number }): void {
    // patch the form values
    this.form.patchValue({ a: payload.a, b: payload.b, c: payload.c, xMin: payload.xMin, xMax: payload.xMax });
    // fetch full calculation from backend to get points and other derived values
    this.fetchQuadratic();
  }

  private solveRoots(a: number, b: number, c: number, discriminant: number): number[] {
    if (a === 0) {
      if (b === 0) {
        return [];
      }
      return [(-c) / b];
    }

    if (discriminant < 0) {
      return [];
    }

    if (discriminant === 0) {
      return [(-b) / (2 * a)];
    }

    const sqrtD = Math.sqrt(discriminant);
    return [((-b) + sqrtD) / (2 * a), ((-b) - sqrtD) / (2 * a)];
  }
}
