import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map, switchMap, tap, catchError, retry } from 'rxjs/operators';
import { concat, of } from 'rxjs';

import { FunctionLineChartComponent } from '../function-line-chart/function-line-chart.component';
import { FunctionApiService } from '../../services/function-api.service';

@Component({
  selector: 'app-function-graph',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FunctionLineChartComponent],
  templateUrl: './function-graph.component.html',
  styleUrl: './function-graph.component.scss'
})
export class FunctionGraphComponent {
  private readonly api = inject(FunctionApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly defaultSamples = 260;

  readonly form = new FormGroup({
    expression: new FormControl<string>('x^2', { nonNullable: true }),
    xMin: new FormControl<number>(-10, { nonNullable: true }),
    xMax: new FormControl<number>(10, { nonNullable: true })
  });

  points: Array<{ x: number; y: number }> = [];
  isLoading = false;
  hasError = false;
  errorMessage = '';
  isConnecting = false;

  constructor() {
    // Track whether this is the very first emission (auto-fired on startup)
    // so we can show a friendly "connecting…" message instead of an error
    // if the backend hasn't finished starting yet.
    let isFirstEmission = true;

    concat(
      of(this.form.getRawValue()),
      this.form.valueChanges.pipe(debounceTime(260))
    )
      .pipe(
        map((raw) => ({
          expression: (raw.expression ?? '').trim(),
          x_min: Number(raw.xMin),
          x_max: Number(raw.xMax),
          samples: this.defaultSamples,
          _first: isFirstEmission  // carry the flag through
        })),
        distinctUntilChanged((prev, curr) =>
          prev.expression === curr.expression &&
          prev.x_min === curr.x_min &&
          prev.x_max === curr.x_max
        ),
        tap(() => {
          this.isLoading = true;
          this.hasError = false;
          this.errorMessage = '';
        }),
        switchMap((payload) => {
          const first = payload._first;
          isFirstEmission = false;       // subsequent changes are user-driven

          if (!payload.expression) {
            return of({ ok: false as const, message: 'Escribe una expresion valida.' });
          }

          const req = { expression: payload.expression, x_min: payload.x_min, x_max: payload.x_max, samples: payload.samples };

          // On first load the backend may still be starting up (concurrently).
          // Retry automatically for ~12 s and show a "connecting…" indicator.
          const call$ = first
            ? this.api.evaluate(req).pipe(
                tap({ error: () => { this.isConnecting = true; } }),
                retry({ count: 8, delay: 1500 })
              )
            : this.api.evaluate(req);

          return call$.pipe(
            map((response) => ({ ok: true as const, points: response.points })),
            tap(() => { this.isConnecting = false; }),
            catchError((error) => {
              this.isConnecting = false;
              return of({ ok: false as const, message: this.extractErrorMessage(error) });
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.isLoading = false;

          if (result.ok) {
            this.points = result.points;
            this.hasError = false;
            this.errorMessage = '';
            return;
          }

          this.points = [];
          this.hasError = true;
          this.errorMessage = result.message;
        }
      });
  }

  /** Called when the user drags a control node in the 3D chart editor. */
  onExpressionFromChart(expr: string): void {
    this.form.patchValue({ expression: expr }, { emitEvent: true });
  }

  private extractErrorMessage(error: unknown): string {
    const maybeHttpError = error as { error?: { detail?: string } };
    return maybeHttpError?.error?.detail ?? 'No se pudo evaluar la funcion en el backend.';
  }
}
