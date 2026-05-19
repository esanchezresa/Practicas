import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParaboloideHiperbolico } from './paraboloide-hiperbolico.component.ts';

describe('ParaboloideHiperbolico', () => {
  let component: ParaboloideHiperbolico;
  let fixture: ComponentFixture<ParaboloideHiperbolico>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParaboloideHiperbolico],
    }).compileComponents();

    fixture = TestBed.createComponent(ParaboloideHiperbolico);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
