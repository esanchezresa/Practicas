import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'funciones',
    pathMatch: 'full',
  },
  {
    path: 'funciones',
    loadComponent: () =>
      import('./components/function-graph/function-graph.component').then(
        (m) => m.FunctionGraphComponent,
      ),
  },
  {
    path: 'paraboloide',
    loadComponent: () =>
      import('./features/paraboloide-hiperbolico/paraboloide-hiperbolico.component').then(
        (m) => m.ParaboloideHiperbolicoComponent,
      ),
  },
  {
    path: 'geo-3d',
    loadComponent: () =>
      import('./components/geo3d-viewer/geo3d-viewer.component').then(
        (m) => m.Geo3dViewerComponent,
      ),
  },
  {
    path: 'spain-graph',
    loadComponent: () =>
      import('./components/spain-graph/spain-graph.component').then(
        (m) => m.SpainGraphComponent,
      ),
  },
];
