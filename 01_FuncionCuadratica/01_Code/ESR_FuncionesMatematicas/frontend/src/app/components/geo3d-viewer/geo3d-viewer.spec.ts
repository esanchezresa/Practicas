import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Geo3dViewerComponent } from './geo3d-viewer.component';

describe('Geo3dViewer', () => {
  let component: Geo3dViewerComponent;
  let fixture: ComponentFixture<Geo3dViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Geo3dViewerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(Geo3dViewerComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
