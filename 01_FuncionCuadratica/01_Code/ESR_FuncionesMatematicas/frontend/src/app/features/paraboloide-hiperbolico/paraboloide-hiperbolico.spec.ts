import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParaboloideHiperbolicoComponent } from './paraboloide-hiperbolico.component';

describe('ParaboloideHiperbolico', () => {
  let component: ParaboloideHiperbolicoComponent;
  let fixture: ComponentFixture<ParaboloideHiperbolicoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParaboloideHiperbolicoComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ParaboloideHiperbolicoComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
