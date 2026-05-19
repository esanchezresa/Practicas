import { TestBed } from '@angular/core/testing';

import { Surface } from './surface.service';

describe('Surface', () => {
  let service: Surface;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Surface);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
