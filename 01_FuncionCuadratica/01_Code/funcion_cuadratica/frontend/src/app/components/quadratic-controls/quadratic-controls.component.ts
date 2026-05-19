import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-quadratic-controls',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './quadratic-controls.component.html',
  styleUrl: './quadratic-controls.component.scss'
})
export class QuadraticControlsComponent {
  @Input({ required: true }) form!: FormGroup<{
    a: FormControl<number>;
    b: FormControl<number>;
    c: FormControl<number>;
    xMin: FormControl<number>;
    xMax: FormControl<number>;
  }>;

  @Input({ required: true }) discriminant = 0;
  @Input({ required: true }) rootsDisplay = '';
  @Input({ required: true }) vertexX: number | null = 0;
  @Input({ required: true }) vertexY: number | null = 0;
  @Input() hasError = false;

  onSliderInput(controlName: 'a' | 'b' | 'c', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.form.controls[controlName].setValue(value);
  }

  formatNumber(value: number | null, digits = 4): string {
    if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
      return 'No definido';
    }
    return value.toFixed(digits);
  }
}
